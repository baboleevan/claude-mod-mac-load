import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Prefs, Snapshot } from '../types'
import {
  DEFAULT_INTERVAL,
  INTERVALS,
  INTERVAL_LABEL,
  isDue,
  isSlowerThanTarget,
  parseInterval,
  secondsLabel,
} from './cadence'
import { IOSTAT_ARGV, parseIostat } from './iostat'
import {
  DEFAULT_POSITION,
  POSITIONS,
  POSITION_LABEL,
  isBandMissing,
  layoutFor,
  parsePosition,
  type Position,
} from './layout'
import { fitName, parsePsNames, psArgv, uniquePids, withFullNames } from './names'
import { parseFreePercent, parseTop } from './top'

const PANE = 'mac-load'
const TITLE = 'Mac 부하'
/** 측정을 시작할 때가 됐는지 살피는 간격(ms)입니다. 맥에서는 이보다 짧게 잴 수 없어 이 정도면 충분합니다. */
const HEARTBEAT_MS = 250
/** 그래프에 남기는 최근 측정 횟수입니다. */
const HISTORY = 120

const EMPTY: Snapshot = {
  isReady: false,
  at: 0,
  stepMs: 0,
  procsAt: 0,
  cores: 0,
  cpu: { user: 0, sys: 0, idle: 100 },
  load: [0, 0, 0],
  mem: { usedGb: 0, totalGb: 0, wiredGb: 0, compressedGb: 0 },
  freePercent: null,
  procs: [],
  memProcs: [],
  history: [],
  error: null,
  procsError: null,
}

const DEFAULT_SETTINGS: Prefs = {
  intervalMs: DEFAULT_INTERVAL,
  isCollapsed: false,
  position: DEFAULT_POSITION,
}

// 값의 모양을 바꾸면 shape 태그도 바꿉니다. 이전 버전이 저장한 값은 다시 불러올 때 버려집니다.
const snapshot = atom({ plugin: 'mac-load', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-3',
})
const settings = atom({ plugin: 'mac-load', key: 'prefs' } as const, DEFAULT_SETTINGS, {
  shape: 'prefs-2',
})

/**
 * 두 번째 표본(직전 1초의 값)을 쓰려고 두 번 읽습니다. 한 번에 약 3초가 걸리고 CPU를 코어 하나의 절반 넘게 씁니다.
 * `-n`을 주지 않아 모든 프로세스가 나오며, 여기서 CPU 순·메모리 순 상위 5개를 각각 뽑습니다(비용은 `-n 5`와 같습니다).
 */
const TOP_ARGV = [
  'top', '-l', '2', '-s', '1', '-o', 'cpu', '-stats', 'pid,command,cpu,mem',
] as const

const SPARKS = '▁▂▃▄▅▆▇█'

/** 0~100 값 하나를 막대 높이 글자로 바꿉니다. */
function spark(percent: number): string {
  const index = Math.floor((Math.min(100, Math.max(0, percent)) / 100) * SPARKS.length)
  return SPARKS[Math.min(SPARKS.length - 1, index)]!
}

/** 사용률에 맞게 채운 막대입니다. */
function bar(percent: number, width: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** 색만으로 알리지 않도록 숫자도 함께 그리지만, 한눈에 보이게 단계별 색을 줍니다. */
function levelColor(percent: number, warn: number, danger: number): 'success' | 'warning' | 'error' {
  return percent >= danger ? 'error' : percent >= warn ? 'warning' : 'success'
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const round1 = (n: number) => Math.round(n * 10) / 10
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 측정은 둘로 나뉩니다. 부하(CPU·부하 평균·메모리 여유율)는 가벼운 iostat·memory_pressure로 고른 주기마다 읽고,
// 프로세스 목록은 top이 한 번에 약 3초 걸려 따로 읽습니다. 각자 재는 중이면 겹쳐 재지 않습니다.
// 모듈 변수라 다시 불러오면(핫 리로드) 처음 상태로 돌아가고, 옛 타이머는 엔진이 함께 멈춥니다.
const gauge = { isBusy: false, startedAt: -Infinity }
const procs = { isBusy: false, startedAt: -Infinity }
let isStarted = false
// 띠를 고른 시각과, 띠가 마지막으로 그려진 시각입니다(0은 없음). 고른 뒤 한참 지나도 그려지지 않으면 창으로 되돌립니다.
let bandSince = 0
let bandSeenAt = 0

/** iostat·memory_pressure로 CPU·부하 평균·메모리 여유율을 읽어 값을 갱신합니다. */
async function measureGauges($: EngineInterface): Promise<void> {
  try {
    const [io, pressure] = await Promise.all([
      $.process.run(IOSTAT_ARGV, { timeoutMs: 8_000 }),
      // 시스템 메모리 여유율은 보조 값이라 못 읽어도 나머지는 그립니다.
      $.process.run(['memory_pressure', '-Q'], { timeoutMs: 8_000 }).catch(() => null),
    ])
    const reading = io.exitCode === 0 ? parseIostat(io.stdout) : null
    if (!reading) {
      const reason =
        io.exitCode === 0 ? 'iostat 출력을 읽지 못했습니다.' : `iostat이 ${io.exitCode}로 끝났습니다.`
      await update($, snapshot, prev => ({ ...prev, error: reason }))
      return
    }
    const free = pressure && pressure.exitCode === 0 ? parseFreePercent(pressure.stdout) : null
    const at = await $.clock.now()
    await update($, snapshot, prev => {
      // macOS의 top은 캐시까지 "사용"으로 세어 늘 가득 차 보이므로, 여유율을 읽었으면 그 보수값(100 - 여유율)을 막대로 씁니다.
      // 못 읽었으면 top이 준 양으로, 그것도 없으면 직전 값을 그대로 둡니다.
      const memPercent =
        free !== null
          ? 100 - free
          : prev.mem.totalGb > 0
            ? (prev.mem.usedGb / prev.mem.totalGb) * 100
            : (prev.history[prev.history.length - 1]?.mem ?? 0)
      return {
        ...prev,
        isReady: true,
        at,
        stepMs: prev.at > 0 ? at - prev.at : 0,
        cpu: reading.cpu,
        load: reading.load,
        freePercent: free,
        history: [...prev.history, { cpu: round1(100 - reading.cpu.idle), mem: round1(memPercent) }].slice(
          -HISTORY,
        ),
        error: null,
      }
    })
  } catch (error) {
    const reason = reasonOf(error)
    await update($, snapshot, prev => ({ ...prev, error: reason }))
  }
}

/** 프로세스의 전체 이름을 ps로 읽습니다. 못 읽으면 빈 목록입니다(top이 준 이름을 그대로 씁니다). */
async function readNames($: EngineInterface, pids: readonly number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map()
  try {
    const ps = await $.process.run(psArgv(pids), { timeoutMs: 5_000 })
    return parsePsNames(ps.stdout)
  } catch {
    return new Map()
  }
}

/** top으로 CPU·메모리 상위 프로세스와 메모리 양을 읽어 값을 갱신합니다. */
async function measureProcesses($: EngineInterface): Promise<void> {
  try {
    const top = await $.process.run(TOP_ARGV, { timeoutMs: 15_000 })
    const reading = top.exitCode === 0 ? parseTop(top.stdout) : null
    if (!reading) {
      const reason = top.exitCode === 0 ? 'top 출력을 읽지 못했습니다.' : `top이 ${top.exitCode}로 끝났습니다.`
      await update($, snapshot, prev => ({ ...prev, procsError: reason }))
      return
    }
    // top은 이름을 16자에서 자르므로, ps로 전체 이름을 받아 바꿉니다. 못 읽으면 top의 이름 그대로 보여 줍니다.
    const pids = uniquePids(reading.procs, reading.memProcs)
    const names = await readNames($, pids)
    const at = await $.clock.now()
    await update($, snapshot, prev => ({
      ...prev,
      procsAt: at,
      mem: reading.mem,
      procs: withFullNames(reading.procs, names),
      memProcs: withFullNames(reading.memProcs, names),
      procsError: null,
    }))
  } catch (error) {
    const reason = reasonOf(error)
    await update($, snapshot, prev => ({ ...prev, procsError: reason }))
  }
}

/**
 * 측정을 시작할 때가 된 것을 시작합니다. 타이머가 짧은 간격으로 부르고, 측정이 끝날 때도 불러서
 * 재는 데 주기만큼 걸린 측정(1초 이하 주기)은 기다리지 않고 바로 이어 잽니다.
 * 접어 두면 비싼 프로세스 측정은 멈추고 부하만 잽니다.
 */
async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const { intervalMs, isCollapsed, position } = await read($, settings)

  // 띠를 골랐는데 한 번도 그려지지 않으면(이 화면에서는 띠가 안 보이는 경우) 사용자가 갇히지 않도록 창으로 되돌립니다.
  if (position === 'band' && isBandMissing({ since: bandSince, seenAt: bandSeenAt, now })) {
    bandSince = 0
    await changePosition($, 'pane')
    $.ui.toast('아래쪽 띠가 그려지지 않아 창으로 되돌렸어요. 이 화면에서는 띠를 쓸 수 없는 것 같아요.')
  }

  // 확인과 표시 사이에 await가 없어 두 번 불러도 한 번만 시작됩니다.
  if (isDue({ isBusy: gauge.isBusy, startedAt: gauge.startedAt, now, intervalMs })) {
    gauge.isBusy = true
    gauge.startedAt = now
    void measureGauges($).finally(() => {
      gauge.isBusy = false
      void tick($).catch(() => undefined)
    })
  }
  if (!isCollapsed && isDue({ isBusy: procs.isBusy, startedAt: procs.startedAt, now, intervalMs })) {
    procs.isBusy = true
    procs.startedAt = now
    void measureProcesses($).finally(() => {
      procs.isBusy = false
      void tick($).catch(() => undefined)
    })
  }
}

/** 코어 수를 한 번 읽고 측정을 시작합니다. */
async function start($: EngineInterface): Promise<void> {
  try {
    const { stdout } = await $.process.run(['sysctl', '-n', 'hw.ncpu'], { timeoutMs: 5_000 })
    const cores = Number(stdout.trim())
    if (Number.isFinite(cores) && cores > 0) await update($, snapshot, prev => ({ ...prev, cores }))
  } catch {
    // 코어 수를 못 읽어도 부하 평균 옆의 참고 값만 빠집니다.
  }
  void tick($).catch(() => undefined)
  $.clock.every(HEARTBEAT_MS, () => {
    void tick($).catch(() => undefined)
  })
}

/** 위치를 바꿉니다. 띠로 옮기면 창을 닫고, 창으로 옮기면 창을 엽니다(띠는 그리는 쪽이 알아서 나타나고 사라집니다). */
async function changePosition($: EngineInterface, position: Position): Promise<void> {
  bandSince = position === 'band' ? await $.clock.now() : 0
  await update($, settings, prev => ({ ...prev, position }))
  try {
    if (position === 'band') await $.ui.close({ id: PANE })
    else await $.ui.open({ id: PANE, title: TITLE })
  } catch {
    // 창을 여닫지 못해도 위치 설정은 바뀌었고, 띠는 다음에 그릴 때 따라갑니다.
  }
}

/**
 * 보여 주던 것을 닫습니다. 창은 닫고, 띠는 닫는 길이 없어서 위치를 `off`로 둬 그리지 않게 합니다.
 * 다시 열려면 `/mac-load`(창) 또는 `/mac-load band`(띠)를 씁니다.
 */
async function closeView($: EngineInterface, shown: Prefs['position']): Promise<void> {
  if (shown === 'band') {
    bandSince = 0
    await update($, settings, prev => ({ ...prev, position: 'off' as const }))
    $.ui.toast('아래쪽 띠를 닫았어요. 다시 열려면 /mac-load (띠로는 /mac-load band)')
    return
  }
  try {
    await $.ui.close({ id: PANE })
  } catch {
    // 이미 닫혀 있거나 다른 훅이 막았으면 그대로 둡니다.
  }
}

type ResolveInput = Parameters<EngineInterface['ui']['resolve']>[0]

/** 프로세스 줄에서 이름 앞에 오는 칸 수입니다(CPU 목록: "  9.0% 1307M ", 메모리 목록: "  1307M   9.0% "). */
const CPU_ROW_PREFIX = 15
const MEM_ROW_PREFIX = 16

/** 이름에 쓸 수 있는 칸 수입니다. 줄바꿈으로 표가 깨지지 않게, 모자라면 이름을 `…`로 줄입니다. */
const nameWidth = (columns: number, prefix: number) => Math.max(8, columns - prefix)

/** 창이나 띠에 그릴 때 알아야 하는 것입니다. */
type View = {
  /** 지금 그리는 곳입니다. */
  position: Position
  /** 그릴 수 있는 칸 수입니다. */
  columns: number
  /** 그릴 수 있는 줄 수입니다. 창은 스스로 스크롤하므로 제한이 없습니다. */
  maxRows: number
}

/** 창과 띠가 함께 쓰는 그림입니다. */
async function draw($: EngineInterface, e: ResolveInput, view: View) {
  const { Box, Text, Button, Select } = $.ui.resolve(e)
  const [s, config] = await Promise.all([read($, snapshot), read($, settings)])
  const columns = Math.max(28, view.columns)
  // 앞의 이름표(6칸)와 뒤의 숫자(7칸)를 뺀 나머지가 막대 길이입니다.
  const barWidth = Math.min(40, Math.max(8, columns - 6 - 7))

  // 접기·펴기 버튼입니다. 창이나 띠에 키보드가 있을 때는 c로도 누를 수 있습니다.
  const toggle = (
    <Button
      key="toggle"
      hotkey="c"
      label={config.isCollapsed ? '▶ 펼치기' : '▼ 접기'}
      onPress={() => {
        void update($, settings, prev => ({ ...prev, isCollapsed: !prev.isCollapsed }))
      }}
    />
  )

  // 닫기 버튼입니다. 창이나 띠에 키보드가 있을 때는 x로도 누를 수 있습니다.
  const close = (
    <Button
      key="close"
      hotkey="x"
      label="✕ 닫기"
      onPress={() => {
        void closeView($, view.position)
      }}
    />
  )

  const last = s.history[s.history.length - 1]
  const cpuPercent = round1(100 - s.cpu.idle)
  const memPercent = last?.mem ?? 0
  const cpuColor = levelColor(cpuPercent, 60, 85)
  const memColor = levelColor(memPercent, 70, 88)

  // 띠는 자리에 맞춰 줄입니다. 자리가 아주 좁으면(mini) 접은 것과 같은 한 줄 요약만 그립니다.
  const layout = layoutFor(view.position, view.maxRows)
  const isMini = layout === 'mini'

  // 접으면 한 줄 요약만 보여, 차지하는 자리를 줄입니다.
  if (config.isCollapsed || isMini) {
    return (
      <Box flexDirection="row" gap={2}>
        {isMini ? null : toggle}
        <Text>
          <Text bold>{TITLE}</Text>
          {s.isReady ? (
            <Text>
              {' '}
              · CPU <Text color={cpuColor}>{cpuPercent}%</Text> · 메모리 <Text color={memColor}>{memPercent}%</Text> ·
              부하 {s.load[0]}
            </Text>
          ) : (
            <Text dimColor> · 측정 중…</Text>
          )}
          {isMini ? <Text dimColor> · 자리가 좁아 한 줄만 (/mac-load 로 창으로)</Text> : null}
        </Text>
        {close}
      </Box>
    )
  }

  // 폭이 넉넉하면 두 선택 창을 한 줄에, 좁으면 두 줄에 놓습니다. 둘 사이에는 간격을 두지 않습니다.
  const header = (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2}>
        {toggle}
        <Text bold>{TITLE}</Text>
        {close}
      </Box>
      <Box flexDirection={columns >= 48 ? 'row' : 'column'} gap={0}>
        <Select
          key="interval"
          label="갱신 주기"
          options={INTERVALS.map(ms => ({ value: String(ms), label: INTERVAL_LABEL[ms] }))}
          value={String(config.intervalMs)}
          onSelect={value => {
            const intervalMs = parseInterval(value)
            if (intervalMs !== null) void update($, settings, prev => ({ ...prev, intervalMs }))
          }}
        />
        <Select
          key="position"
          label="위치"
          options={POSITIONS.map(position => ({ value: position, label: POSITION_LABEL[position] }))}
          value={config.position}
          onSelect={value => {
            const position = parsePosition(value)
            if (position !== null) void changePosition($, position)
          }}
        />
      </Box>
    </Box>
  )

  if (!s.isReady) {
    return (
      <Box flexDirection="column">
        {header}
        {s.error ? (
          <Text color="error">측정하지 못했습니다: {s.error}</Text>
        ) : (
          <Text dimColor>첫 측정 중… (약 1초)</Text>
        )}
      </Box>
    )
  }

  const loadRatio = s.cores > 0 ? s.load[0] / s.cores : 0
  const trail = s.history.slice(-Math.max(1, columns - 2))
  // 맥은 CPU를 1초보다 짧게 잴 수 없어서, 0.5초를 골라도 실제로는 약 1초마다 갱신됩니다.
  const cadence =
    s.stepMs <= 0
      ? '첫 갱신 중…'
      : isSlowerThanTarget(config.intervalMs, s.stepMs)
        ? `실제 ${secondsLabel(s.stepMs)}마다 (1초보다 짧게는 못 잼)`
        : `${secondsLabel(s.stepMs)}마다`

  // 띠에 전체 내용이 들어가지 않으면 막대·그래프·부하 평균만 그립니다(프로세스 목록 없이).
  if (layout === 'compact') {
    return (
      <Box flexDirection="column">
        {header}
        <Text dimColor>
          {cadence} · {timeOf(s.at)}
        </Text>
        <Text>
          CPU   <Text color={cpuColor}>{bar(cpuPercent, barWidth)}</Text> {String(cpuPercent).padStart(5)}%
        </Text>
        <Text color={cpuColor}>{trail.map(sample => spark(sample.cpu)).join('')}</Text>
        <Text>
          메모리 <Text color={memColor}>{bar(memPercent, barWidth)}</Text> {String(memPercent).padStart(5)}%
        </Text>
        <Text color={memColor}>{trail.map(sample => spark(sample.mem)).join('')}</Text>
        <Text>
          부하 평균 <Text color={levelColor(loadRatio * 100, 70, 100)}>{s.load.join(' · ')}</Text>
          <Text dimColor>{s.cores > 0 ? ` (코어 ${s.cores}개)` : ''}</Text>
          <Text dimColor> · 프로세스 목록은 자리가 모자라 접었어요</Text>
        </Text>
        {s.error && <Text color="error">마지막 측정 실패: {s.error}</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text dimColor>
        {cadence} · {timeOf(s.at)}
      </Text>

      <Text>
        CPU   <Text color={cpuColor}>{bar(cpuPercent, barWidth)}</Text> {String(cpuPercent).padStart(5)}%
      </Text>
      <Text dimColor>
        사용자 {s.cpu.user}% · 시스템 {s.cpu.sys}% · 유휴 {s.cpu.idle}%
      </Text>
      <Text color={cpuColor}>{trail.map(sample => spark(sample.cpu)).join('')}</Text>

      <Text> </Text>
      <Text>
        메모리 <Text color={memColor}>{bar(memPercent, barWidth)}</Text> {String(memPercent).padStart(5)}%
      </Text>
      <Text dimColor>
        {s.freePercent !== null ? `여유율 ${s.freePercent}%` : '여유율을 읽지 못함'}
        {s.procsAt > 0
          ? ` · ${round1(s.mem.usedGb)}/${round1(s.mem.totalGb)}GB 사용(top) · 와이어드 ${round1(s.mem.wiredGb)}` +
            (s.mem.compressedGb > 0 ? ` · 압축 ${round1(s.mem.compressedGb)}` : '')
          : ''}
      </Text>
      <Text color={memColor}>{trail.map(sample => spark(sample.mem)).join('')}</Text>

      <Text> </Text>
      <Text>
        부하 평균 <Text color={levelColor(loadRatio * 100, 70, 100)}>{s.load.join(' · ')}</Text>
        <Text dimColor>{s.cores > 0 ? ` (코어 ${s.cores}개)` : ''}</Text>
      </Text>

      <Text> </Text>
      <Text>
        <Text bold>CPU 상위 프로세스</Text>
        <Text dimColor>
          {s.procsAt > 0 ? ` · ${timeOf(s.procsAt)} 기준` : ' · 측정 중… (처음에는 약 3초)'}
        </Text>
      </Text>
      {s.procsAt > 0 && s.procs.length === 0 && <Text dimColor>표시할 프로세스가 없습니다.</Text>}
      {s.procs.map(proc => (
        <Text>
          {proc.cpu.toFixed(1).padStart(6)}% <Text dimColor>{proc.mem.padStart(6)}</Text> {fitName(proc.command, nameWidth(columns, CPU_ROW_PREFIX))}
        </Text>
      ))}

      <Text> </Text>
      <Text bold>메모리 상위 프로세스</Text>
      {s.procsAt > 0 && s.memProcs.length === 0 && <Text dimColor>표시할 프로세스가 없습니다.</Text>}
      {s.memProcs.map(proc => (
        <Text>
          {proc.mem.padStart(7)} <Text dimColor>{proc.cpu.toFixed(1).padStart(6)}%</Text> {fitName(proc.command, nameWidth(columns, MEM_ROW_PREFIX))}
        </Text>
      ))}

      {s.error && <Text color="error">마지막 측정 실패: {s.error}</Text>}
      {s.procsError && <Text color="error">프로세스 측정 실패: {s.procsError}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mac-load',
      description: '로컬 맥의 CPU·메모리 부하를 실시간으로 보는 창을 연다',
    })
    // 띠를 고른 채 다시 불러왔다면 창은 열지 않고, 남아 있는 창이 있으면 닫습니다.
    const { position } = await read($, settings)
    if (position === 'pane') void $.ui.open({ id: PANE, title: TITLE })
    else {
      if (position === 'band') bandSince = await $.clock.now()
      void $.ui.close({ id: PANE }).catch(() => undefined)
    }
    if (!isStarted) {
      isStarted = true
      void start($)
    }
    return next(e)
  })

  // `/mac-load`는 창을 엽니다(띠가 안 보일 때 되돌아오는 길이기도 합니다). `/mac-load band`는 아래쪽 띠로 옮기고, `/mac-load close`는 닫습니다.
  on('command.run', { command: 'mac-load' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'band') {
      await changePosition($, 'band')
      return { text: '아래쪽 띠로 옮겼어요. 띠가 안 보이면 /mac-load 로 창을 다시 여세요.' }
    }
    if (arg === 'close') {
      const { position } = await read($, settings)
      await closeView($, position)
      return { text: '닫았어요. 다시 열려면 /mac-load (띠로는 /mac-load band)' }
    }
    if (arg !== '' && arg !== 'pane') {
      return { text: '쓰는 법: /mac-load (창으로 열기) · /mac-load band (아래쪽 띠로) · /mac-load close (닫기)' }
    }
    await changePosition($, 'pane')
    return { text: 'Mac 부하 창을 열었습니다.' }
  })

  // 창: 화면 환경에 따라 Claude Code가 자리를 정합니다(전체 화면에 폭 110칸 이상이면 오른쪽).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return draw($, e, {
      position: 'pane',
      columns: e.props?.bodyColumns ?? e.viewport?.columns ?? 40,
      maxRows: Number.POSITIVE_INFINITY,
    })
  })

  // 띠: 프롬프트 바로 위. 창을 고른 동안과 설문이 떠 있는 동안에는 비켜 줍니다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { position } = await read($, settings)
    if (position !== 'band' || e.props.hasSurvey) return next(e)
    try {
      const tree = await draw($, e, {
        position: 'band',
        columns: e.props.bodyColumns,
        maxRows: e.props.maxRows,
      })
      // 그려졌다는 표시입니다. 이것이 없으면 tick이 띠를 쓸 수 없는 화면으로 보고 창으로 되돌립니다.
      bandSeenAt = await $.clock.now()
      return tree
    } catch (error) {
      // 그리다 실패하면 엔진은 조용히 건너뛰어 아무것도 안 보이므로, 이유를 눈에 보이게 그립니다.
      const { Text } = $.ui.resolve(e)
      bandSeenAt = await $.clock.now()
      return <Text color="error">Mac 부하 띠를 그리지 못했습니다: {reasonOf(error)}</Text>
    }
  })
}
