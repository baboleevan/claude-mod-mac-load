import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mac-load',
  component: 'Pane',
  requestId: 'mac-load',
  props: {
    title: 'Mac 부하',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const IOSTAT = ` us sy id   1m   5m   15m
 20 13 67  5.16 7.01 6.75
 16 11 73  5.16 7.01 6.75
`

const TOP = `Processes: 4 total, 1 running, 3 sleeping, 90 threads
2026/11/06 17:50:00
Load Avg: 1.00, 2.00, 3.00
CPU usage: 10.0% user, 5.0% sys, 85.0% idle
PhysMem: 8G used (1G wired, 2G compressor), 1G unused.

PID    COMMAND          %CPU  MEM
10     alpha            0.5   900M
11     bravo            30.0  3G
`

const run = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** 세션을 시작해, 가짜 시계와 명령 결과로 측정이 도는 상태를 만듭니다. */
async function startSession($: any, on: any) {
  const clock = mock.clock(on)
  const calls: string[] = []
  // 창을 열고 닫은 기록입니다(id).
  const opened: string[] = []
  const closed: string[] = []
  const toasts: string[] = []
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'mac-load' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('process.run', async (_: unknown, e: { argv: readonly string[] }) => {
    const name = e.argv[0] ?? ''
    calls.push(name)
    // 실제와 비슷하게 iostat은 1초, top은 3초가 걸린다.
    if (name === 'iostat') {
      await clock.sleep(1000)
      return { value: run(IOSTAT) }
    }
    if (name === 'top') {
      await clock.sleep(3000)
      return { value: run(TOP) }
    }
    if (name === 'memory_pressure') return { value: run('System-wide memory free percentage: 60%\n') }
    // top이 자른 이름 대신 쓸 전체 이름입니다.
    if (name === 'ps') {
      return {
        value: run(
          '   10 /Applications/Alpha.app/Contents/MacOS/alpha-with-a-very-long-process-name\n   11 /bin/bravo\n',
        ),
      }
    }
    return { value: run('20\n') }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const count = (name: string) => calls.filter(call => call === name).length
  return { clock, count, opened, closed, toasts }
}

/** 프롬프트 위 띠를 그릴 때 엔진이 주는 값입니다. */
const band = (maxRows: number) =>
  ({
    plugin: 'mac-load',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  }) as const

test('접기 버튼을 누르면 한 줄 요약만 남고, 다시 누르면 펼쳐진다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // 펼친 모습: 갱신 주기 선택 창과 CPU 구역이 있다.
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('접기')
  expect(await ui.find({ key: 'interval' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /메모리 상위 프로세스/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('펼치기')
  expect(await ui.find({ key: 'interval' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /메모리 상위 프로세스/ })).toBeUndefined()
  // 접어도 요약에는 CPU 값이 남는다(iostat 두 번째 줄: 유휴 73% → 27%).
  expect(await ui.find({ type: 'Text', text: /CPU 27%/ })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'toggle' }))?.text).toContain('접기')
  expect(await ui.find({ key: 'interval' })).toBeDefined()
  await ui.unmount()
})

test('기본 주기는 2초이고 1초·0.5초로 바꿀 수 있다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(1500)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const picker = await ui.find({ key: 'interval' })
  expect(JSON.stringify(picker)).toContain('2초')

  await ui.select({ key: 'interval', value: '500' })
  expect(JSON.stringify(await ui.find({ key: 'interval' }))).toContain('0.5초')
  await ui.select({ key: 'interval', value: '1000' })
  expect(JSON.stringify(await ui.find({ key: 'interval' }))).toContain('1초')
  await ui.unmount()
})

test('고른 주기마다 부하를 읽는다(1초보다 짧게는 못 재서 0.5초도 약 1초)', async ($, on) => {
  const { clock, count } = await startSession($, on)

  // 2초: 10초 동안 약 5번.
  await clock.advance(10_000)
  const at2 = count('iostat')
  expect(at2).toBeGreaterThanOrEqual(4)
  expect(at2).toBeLessThanOrEqual(6)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'interval', value: '1000' })
  const before1 = count('iostat')
  await clock.advance(10_000)
  const delta1 = count('iostat') - before1
  // 재는 데 1초가 걸려 쉬지 않고 이어 재므로 약 10번.
  expect(delta1).toBeGreaterThanOrEqual(8)
  expect(delta1).toBeLessThanOrEqual(11)

  await ui.select({ key: 'interval', value: '500' })
  const before05 = count('iostat')
  await clock.advance(10_000)
  const delta05 = count('iostat') - before05
  // 0.5초를 골라도 1초보다 빨라지지 않는다.
  expect(delta05).toBeGreaterThanOrEqual(8)
  expect(delta05).toBeLessThanOrEqual(11)
  await ui.unmount()
})

test('접으면 비싼 프로세스 측정(top)을 멈추고, 펼치면 다시 한다', async ($, on) => {
  const { clock, count } = await startSession($, on)
  await clock.advance(10_000)
  expect(count('top')).toBeGreaterThanOrEqual(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'toggle' })
  await clock.advance(4000) // 이미 재던 top이 끝날 시간
  const stopped = count('top')
  const iostatBefore = count('iostat')
  await clock.advance(10_000)
  expect(count('top')).toBe(stopped)
  // 접어도 부하는 계속 잰다.
  expect(count('iostat')).toBeGreaterThan(iostatBefore)

  await ui.press({ key: 'toggle' })
  await clock.advance(1000)
  expect(count('top')).toBeGreaterThan(stopped)
  await ui.unmount()
})

test('위치를 띠로 바꾸면 창을 닫고 띠가 그려지고, 창으로 되돌리면 창이 다시 열린다', async ($, on) => {
  // 엔진은 띠를 그리지 않는다: 플러그인이 비켜 주면 이 글자가 보인다.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>engine</Text>
  })
  const { clock, opened, closed } = await startSession($, on)
  await clock.advance(1500)
  // 처음에는 창이다: 세션이 시작될 때 창이 열리고, 띠는 엔진에 비켜 준다.
  expect(opened).toEqual(['mac-load'])
  const first = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect(await first.find({ type: 'Text', text: /engine/ })).toBeDefined()
  expect(await first.find({ key: 'toggle' })).toBeUndefined()
  await first.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await pane.find({ key: 'position' }))).toContain('오른쪽 창')
  await pane.select({ key: 'position', value: 'band' })
  expect(closed).toEqual(['mac-load'])
  await pane.unmount()

  // 띠를 고른 뒤: 띠가 그려진다(접기 버튼·선택 창이 있다).
  const shown = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect(await shown.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect((await shown.find({ key: 'toggle' }))?.text).toContain('접기')
  expect(JSON.stringify(await shown.find({ key: 'position' }))).toContain('아래쪽 띠')

  // 띠에서 창으로 되돌린다.
  await shown.select({ key: 'position', value: 'pane' })
  expect(opened).toEqual(['mac-load', 'mac-load'])
  await shown.unmount()
  const back = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect(await back.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await back.unmount()
})

test('띠는 자리가 모자라면 프로세스 목록을 접고, 넉넉하면 모두 보여 준다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(5000)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()

  const small = await $.ui.mount({ ...band(12), surface: 'terminal' })
  expect(await small.find({ type: 'Text', text: /메모리 상위 프로세스/ })).toBeUndefined()
  expect(await small.find({ type: 'Text', text: /자리가 모자라/ })).toBeDefined()
  // 줄여도 CPU·메모리 막대와 위치 선택은 남는다.
  expect(await small.find({ type: 'Text', text: /CPU +[█░]/ })).toBeDefined()
  expect(await small.find({ key: 'position' })).toBeDefined()
  await small.unmount()

  const large = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect(await large.find({ type: 'Text', text: /메모리 상위 프로세스/ })).toBeDefined()
  expect(await large.find({ type: 'Text', text: /자리가 모자라/ })).toBeUndefined()
  await large.unmount()
})

const COMMAND = {
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const

test('/mac-load는 창으로 돌아오는 길이고, /mac-load band는 띠로 옮긴다', async ($, on) => {
  const { clock, opened, closed } = await startSession($, on)
  await clock.advance(1500)
  expect(opened).toEqual(['mac-load'])

  const toBand = await $.command.run({ command: 'mac-load', ...COMMAND, args: 'band' })
  expect(JSON.stringify(toBand)).toContain('아래쪽 띠로 옮겼어요')
  expect(closed).toEqual(['mac-load'])

  // 띠가 안 보여도 /mac-load로 창이 다시 열린다.
  const toPane = await $.command.run({ command: 'mac-load', ...COMMAND })
  expect(JSON.stringify(toPane)).toContain('창을 열었습니다')
  expect(opened).toEqual(['mac-load', 'mac-load'])

  // 모르는 인자는 쓰는 법만 알려 주고 아무것도 바꾸지 않는다.
  const help = await $.command.run({ command: 'mac-load', ...COMMAND, args: 'left' })
  expect(JSON.stringify(help)).toContain('쓰는 법')
  expect(opened).toEqual(['mac-load', 'mac-load'])
  expect(closed).toEqual(['mac-load'])
})

test('띠를 골랐는데 한 번도 그려지지 않으면 창으로 되돌리고 알린다', async ($, on) => {
  const { clock, opened, toasts } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()
  expect(opened).toEqual(['mac-load'])

  // 띠를 그려 달라는 요청이 한 번도 없이 유예 시간이 지난다.
  await clock.advance(6000)
  expect(opened).toEqual(['mac-load', 'mac-load'])
  expect(toasts.join('\n')).toContain('창으로 되돌렸어요')

  // 되돌린 뒤에는 창이 기본 위치다.
  const back = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await back.find({ key: 'position' }))).toContain('오른쪽 창')
  await back.unmount()
})

test('띠가 그려지고 있으면 되돌리지 않는다', async ($, on) => {
  const { clock, opened, toasts } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()

  const shown = await $.ui.mount({ ...band(40), surface: 'terminal' })
  await clock.advance(6000)
  expect(opened).toEqual(['mac-load'])
  expect(toasts).toEqual([])
  await shown.unmount()
})

test('띠가 아주 좁으면 한 줄 요약만 그린다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()

  const tiny = await $.ui.mount({ ...band(4), surface: 'terminal' })
  expect(await tiny.find({ type: 'Text', text: /자리가 좁아/ })).toBeDefined()
  expect(await tiny.find({ type: 'Text', text: /CPU 27%/ })).toBeDefined()
  expect(await tiny.find({ key: 'position' })).toBeUndefined()
  await tiny.unmount()
})

test('선택 창 둘 사이에는 간격이 없다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(1500)
  for (const columns of [60, 40]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal' })
    const drawn = JSON.stringify(await ui.drawn())
    // 두 선택 창을 감싼 Box의 간격은 0이다. 남은 간격(2)은 접기 버튼과 제목 사이 하나뿐이다.
    expect(drawn.match(/"gap":0/g)?.length).toBe(1)
    expect(drawn.match(/"gap":2/g)?.length).toBe(1)
    // 폭이 넉넉하면 한 줄(row), 좁으면 두 줄(column)에 놓는다.
    expect(drawn).toContain(columns >= 48 ? '"flexDirection":"row","gap":0' : '"flexDirection":"column","gap":0')
    await ui.unmount()
  }
})

test('상위 프로세스는 top이 자른 이름이 아니라 전체 이름으로 보이고, 자리가 좁으면 …로 줄인다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(5000)

  const wide = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // top이 준 "alpha"가 아니라 ps의 전체 이름이다(CPU 목록과 메모리 목록 모두).
  const all = await wide.findAll({ type: 'Text', text: /alpha-with-a-very-long-process-name/ })
  expect(all.length).toBeGreaterThanOrEqual(2)
  await wide.unmount()

  const narrow = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns: 30 },
    surface: 'terminal',
  })
  expect(await narrow.find({ type: 'Text', text: /alpha-with-a-v…/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /alpha-with-a-very-long-process-name/ })).toBeUndefined()
  await narrow.unmount()
})

test('창의 닫기 버튼은 창을 닫고, /mac-load로 다시 열린다', async ($, on) => {
  const { clock, opened, closed } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ key: 'close' }))?.text).toContain('닫기')

  await pane.press({ key: 'close' })
  expect(closed).toEqual(['mac-load'])
  await pane.unmount()

  await $.command.run({ command: 'mac-load', ...COMMAND })
  expect(opened).toEqual(['mac-load', 'mac-load'])
})

test('띠의 닫기 버튼은 띠를 치우고, 되돌리지 않으며, /mac-load로 다시 열린다', async ($, on) => {
  // 엔진은 띠를 그리지 않는다: 플러그인이 비켜 주면 이 글자가 보인다.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>engine</Text>
  })
  const { clock, opened, closed, toasts } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()

  const shown = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect((await shown.find({ key: 'close' }))?.text).toContain('닫기')
  await shown.press({ key: 'close' })
  expect(toasts.join('\n')).toContain('띠를 닫았어요')
  await shown.unmount()

  // 닫은 뒤에는 띠가 엔진에 비켜 준다.
  const after = await $.ui.mount({ ...band(40), surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /engine/ })).toBeDefined()
  expect(await after.find({ key: 'toggle' })).toBeUndefined()
  await after.unmount()

  // 일부러 닫은 것이니 "그려지지 않았다"며 창으로 되돌리지 않는다.
  await clock.advance(10_000)
  expect(opened).toEqual(['mac-load'])
  expect(closed).toEqual(['mac-load'])
  expect(toasts.filter(text => text.includes('창으로 되돌렸어요'))).toEqual([])

  // /mac-load로 창이 다시 열린다.
  await $.command.run({ command: 'mac-load', ...COMMAND })
  expect(opened).toEqual(['mac-load', 'mac-load'])
})

test('/mac-load close는 보이던 것을 닫는다', async ($, on) => {
  const { clock, closed } = await startSession($, on)
  await clock.advance(1500)
  const result = await $.command.run({ command: 'mac-load', ...COMMAND, args: 'close' })
  expect(JSON.stringify(result)).toContain('닫았어요')
  expect(closed).toEqual(['mac-load'])
})

test('한 줄로 줄어든 띠에도 닫기 버튼이 있다', async ($, on) => {
  const { clock } = await startSession($, on)
  await clock.advance(1500)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.select({ key: 'position', value: 'band' })
  await pane.unmount()

  const tiny = await $.ui.mount({ ...band(4), surface: 'terminal' })
  expect(await tiny.find({ key: 'close' })).toBeDefined()
  await tiny.unmount()

  // 접어 둔 창에도 있다.
  const folded = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await folded.select({ key: 'position', value: 'pane' })
  await folded.press({ key: 'toggle' })
  expect(await folded.find({ key: 'close' })).toBeDefined()
  await folded.unmount()
})
