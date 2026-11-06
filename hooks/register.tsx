import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import { parseFreePercent, parseTop } from './top'

const PANE = 'mac-load'
const TITLE = 'Mac 부하'
/** 값을 새로 읽는 간격(ms)입니다. top이 1초 동안 재므로 이보다 짧게는 두지 않습니다. */
const INTERVAL_MS = 2000
/** 그래프에 남기는 최근 측정 횟수입니다(2초 간격이면 약 3분). */
const HISTORY = 90

const EMPTY: Snapshot = {
  isReady: false,
  at: 0,
  cores: 0,
  cpu: { user: 0, sys: 0, idle: 100 },
  load: [0, 0, 0],
  mem: { usedGb: 0, totalGb: 0, wiredGb: 0, compressedGb: 0 },
  freePercent: null,
  procs: [],
  history: [],
  error: null,
}

// 값의 모양을 바꾸면 shape 태그도 바꿉니다. 이전 버전이 저장한 값은 다시 불러올 때 버려집니다.
const snapshot = atom({ plugin: 'mac-load', key: 'snapshot' } as const, EMPTY, {
  shape: 'snapshot-1',
})

/** 두 번째 표본(직전 1초의 값)을 쓰려고 두 번 읽고, CPU 순 상위 5개 프로세스를 함께 받습니다. */
const TOP_ARGV = [
  'top', '-l', '2', '-s', '1', '-n', '5', '-o', 'cpu', '-stats', 'pid,command,cpu,mem',
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

function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 측정이 끝나기 전에 다음 주기가 와도 겹쳐 실행하지 않도록 진행 중 여부를 기억합니다.
// 모듈 변수라 다시 불러오면(핫 리로드) 처음 상태로 돌아가고, 옛 타이머는 엔진이 함께 멈춥니다.
let isMeasuring = false
let isStarted = false

/** top·memory_pressure로 지금 부하를 한 번 읽어 값을 갱신합니다. */
async function measure($: EngineInterface): Promise<void> {
  if (isMeasuring) return
  isMeasuring = true
  try {
    const [top, pressure] = await Promise.all([
      $.process.run(TOP_ARGV, { timeoutMs: 15_000 }),
      // 시스템 메모리 여유율은 보조 값이라 못 읽어도 나머지는 그립니다.
      $.process.run(['memory_pressure', '-Q'], { timeoutMs: 8_000 }).catch(() => null),
    ])
    const reading = top.exitCode === 0 ? parseTop(top.stdout) : null
    if (!reading) {
      const reason = top.exitCode === 0 ? 'top 출력을 읽지 못했습니다.' : `top이 ${top.exitCode}로 끝났습니다.`
      await update($, snapshot, prev => ({ ...prev, error: reason }))
      return
    }
    const free =
      pressure && pressure.exitCode === 0 ? parseFreePercent(pressure.stdout) : null
    // macOS의 top은 캐시까지 "사용"으로 세어 늘 가득 차 보이므로, 여유율을 읽었으면 그 보수값(100 - 여유율)을 막대로 씁니다.
    const memPercent =
      free !== null ? 100 - free : (reading.mem.usedGb / Math.max(0.1, reading.mem.totalGb)) * 100
    const at = await $.clock.now()
    await update($, snapshot, prev => ({
      isReady: true,
      at,
      cores: prev.cores,
      cpu: reading.cpu,
      load: reading.load,
      mem: reading.mem,
      freePercent: free,
      procs: reading.procs,
      history: [...prev.history, { cpu: round1(100 - reading.cpu.idle), mem: round1(memPercent) }].slice(
        -HISTORY,
      ),
      error: null,
    }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await update($, snapshot, prev => ({ ...prev, error: reason }))
  } finally {
    isMeasuring = false
  }
}

/** 코어 수를 한 번 읽고 측정을 시작해 주기마다 이어 갑니다. */
async function start($: EngineInterface): Promise<void> {
  try {
    const { stdout } = await $.process.run(['sysctl', '-n', 'hw.ncpu'], { timeoutMs: 5_000 })
    const cores = Number(stdout.trim())
    if (Number.isFinite(cores) && cores > 0) await update($, snapshot, prev => ({ ...prev, cores }))
  } catch {
    // 코어 수를 못 읽어도 부하 평균 옆의 참고 값만 빠집니다.
  }
  void measure($)
  $.clock.every(INTERVAL_MS, () => {
    void measure($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mac-load',
      description: '로컬 맥의 CPU·메모리 부하를 실시간으로 보는 창을 연다',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    if (!isStarted) {
      isStarted = true
      void start($)
    }
    return next(e)
  })

  on('command.run', { command: 'mac-load' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Mac 부하 창을 열었습니다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const columns = Math.max(28, e.props?.bodyColumns ?? e.viewport?.columns ?? 40)
    // 앞의 이름표(6칸)와 뒤의 숫자(7칸)를 뺀 나머지가 막대 길이입니다.
    const barWidth = Math.min(40, Math.max(8, columns - 6 - 7))

    if (!s.isReady) {
      return (
        <Box flexDirection="column">
          <Text bold>{TITLE}</Text>
          {s.error ? (
            <Text color="error">측정하지 못했습니다: {s.error}</Text>
          ) : (
            <Text dimColor>첫 측정 중… (약 1초)</Text>
          )}
        </Box>
      )
    }

    const cpuPercent = round1(100 - s.cpu.idle)
    const last = s.history[s.history.length - 1]
    const memPercent = last?.mem ?? 0
    const cpuColor = levelColor(cpuPercent, 60, 85)
    const memColor = levelColor(memPercent, 70, 88)
    const loadRatio = s.cores > 0 ? s.load[0] / s.cores : 0
    const trail = s.history.slice(-Math.max(1, columns - 2))

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{TITLE}</Text>
          <Text dimColor>
            {' '}
            · {INTERVAL_MS / 1000}초마다 · {timeOf(s.at)}
          </Text>
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
          {s.freePercent !== null ? `여유율 ${s.freePercent}% · ` : ''}
          {round1(s.mem.usedGb)}/{round1(s.mem.totalGb)}GB 사용(top) · 와이어드 {round1(s.mem.wiredGb)}
          {s.mem.compressedGb > 0 ? ` · 압축 ${round1(s.mem.compressedGb)}` : ''}
        </Text>
        <Text color={memColor}>{trail.map(sample => spark(sample.mem)).join('')}</Text>

        <Text> </Text>
        <Text>
          부하 평균 <Text color={levelColor(loadRatio * 100, 70, 100)}>{s.load.join(' · ')}</Text>
          <Text dimColor>{s.cores > 0 ? ` (코어 ${s.cores}개)` : ''}</Text>
        </Text>

        <Text> </Text>
        <Text bold>CPU 상위 프로세스</Text>
        {s.procs.length === 0 && <Text dimColor>표시할 프로세스가 없습니다.</Text>}
        {s.procs.map(proc => (
          <Text>
            {proc.cpu.toFixed(1).padStart(6)}% <Text dimColor>{proc.mem.padStart(6)}</Text> {proc.command}
          </Text>
        ))}

        {s.error && <Text color="error">마지막 측정 실패: {s.error}</Text>}
      </Box>
    )
  })
}
