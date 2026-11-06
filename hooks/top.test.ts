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
  expect(reading?.memProcs.map(p => p.pid)).toEqual([90070, 204, 84844])
})

// 모든 프로세스가 나오는 출력(`-n` 없음)에서 CPU 순과 메모리 순 상위를 각각 뽑는지 보려는 짧은 예입니다.
// 메모리는 K·M·G 단위와 +/- 표시가 섞여 있어, 글자 순이 아니라 실제 크기로 견줘야 합니다.
const MANY = `Processes: 7 total, 1 running, 6 sleeping, 90 threads
2026/11/06 17:50:00
Load Avg: 1.00, 2.00, 3.00
CPU usage: 10.0% user, 5.0% sys, 85.0% idle
PhysMem: 8G used (1G wired, 2G compressor), 1G unused.

PID    COMMAND          %CPU  MEM
10     alpha            0.5   900M
11     bravo            30.0  3G
12     charlie          12.5  512K+
13     delta            80.0  1500M-
14     echo             0.0   2G
15     foxtrot          12.5  700M
16     golf             1.0   40M
`

test('CPU 순과 메모리 순 상위 5개를 각각 뽑는다', async () => {
  const reading = parseTop(MANY)
  expect(reading?.procs.map(p => p.command)).toEqual(['delta', 'bravo', 'charlie', 'foxtrot', 'golf'])
  // 메모리는 3G > 2G > 1500M > 900M > 700M 순이다("512K"나 "40M"은 글자 순으로는 앞서지만 작다).
  expect(reading?.memProcs.map(p => p.command)).toEqual(['bravo', 'echo', 'delta', 'alpha', 'foxtrot'])
  // 개수를 줄 수도 있다.
  expect(parseTop(MANY, 2)?.memProcs.map(p => p.command)).toEqual(['bravo', 'echo'])
})

test('읽을 수 없는 출력은 null이다', async () => {
  expect(parseTop('')).toBeNull()
  expect(parseTop('Processes: 1 total\nLoad Avg: 1, 2, 3')).toBeNull()
})

test('메모리 여유율을 읽는다', async () => {
  expect(parseFreePercent('System-wide memory free percentage: 68%\n')).toBe(68)
  expect(parseFreePercent('알 수 없는 출력')).toBeNull()
})
