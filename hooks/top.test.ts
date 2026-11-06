import { expect, test } from 'claude-code/testing'

import { parseFreePercent, parseTop } from './top'

// 이 맥에서 `top -l 2 -s 1 -n 5 -o cpu -stats pid,command,cpu,mem`로 받은 출력을 줄인 것입니다.
// 첫 표본(부팅 이후 평균)과 두 번째 표본(직전 1초)이 이어져 나옵니다.
const OUTPUT = `Processes: 820 total, 3 running, 817 sleeping, 8600 threads
2026/11/06 17:48:25
Load Avg: 9.00, 7.00, 8.00
CPU usage: 50.0% user, 20.0% sys, 30.0% idle
PhysMem: 60G used (7000M wired, 12G compressor), 400M unused.

PID    COMMAND          %CPU  MEM
1      launchd          9.0   1M
Processes: 821 total, 4 running, 817 sleeping, 8648 threads
2026/11/06 17:48:26
Load Avg: 7.28, 6.68, 8.30
CPU usage: 24.8% user, 10.94% sys, 64.97% idle
SharedLibs: 885M resident, 142M data, 121M linkedit.
PhysMem: 63G used (7222M wired, 13G compressor), 300M unused.

PID    COMMAND          %CPU  MEM
90070  com.apple.Virtua 141.7 17G
204    WindowServer     55.2  2266M-
84844  Aside Helper     17.0  1307M+
`

test('마지막 표본의 CPU·부하·메모리·프로세스를 읽는다', async () => {
  const reading = parseTop(OUTPUT)
  expect(reading?.cpu).toEqual({ user: 24.8, sys: 10.94, idle: 64.97 })
  expect(reading?.load).toEqual([7.28, 6.68, 8.3])
  // 63G 사용 + 300M 남음 → 전체 약 63.29GB
  expect(Math.round((reading?.mem.totalGb ?? 0) * 100) / 100).toBe(63.29)
  expect(Math.round((reading?.mem.wiredGb ?? 0) * 100) / 100).toBe(7.05)
  expect(reading?.mem.compressedGb).toBe(13)
  expect(reading?.procs.map(p => [p.pid, p.command, p.cpu, p.mem])).toEqual([
    [90070, 'com.apple.Virtua', 141.7, '17G'],
    [204, 'WindowServer', 55.2, '2266M-'],
    // 이름에 공백이 있어도 뒤의 두 열을 먼저 떼어 내므로 온전히 읽는다.
    [84844, 'Aside Helper', 17, '1307M+'],
  ])
})

test('읽을 수 없는 출력은 null이다', async () => {
  expect(parseTop('')).toBeNull()
  expect(parseTop('Processes: 1 total\nLoad Avg: 1, 2, 3')).toBeNull()
})

test('메모리 여유율을 읽는다', async () => {
  expect(parseFreePercent('System-wide memory free percentage: 68%\n')).toBe(68)
  expect(parseFreePercent('알 수 없는 출력')).toBeNull()
})
