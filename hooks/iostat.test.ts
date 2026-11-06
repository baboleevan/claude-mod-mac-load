import { expect, test } from 'claude-code/testing'

import { parseIostat } from './iostat'

// `iostat -n 0 -c 2 -w 1`의 출력입니다. 첫 줄은 부팅 이후 평균, 둘째 줄이 직전 1초입니다.
const OUTPUT = `      cpu    load average
 us sy id   1m   5m   15m
 20 13 67  5.16 7.01 6.75
 16 11 73  5.16 7.01 6.75
`

test('마지막 줄(직전 1초)의 CPU와 부하 평균을 읽는다', async () => {
  expect(parseIostat(OUTPUT)).toEqual({
    cpu: { user: 16, sys: 11, idle: 73 },
    load: [5.16, 7.01, 6.75],
  })
})

test('읽을 수 없는 출력은 null이다', async () => {
  expect(parseIostat('')).toBeNull()
  expect(parseIostat('iostat: wait time is < 1')).toBeNull()
  // 디스크 열이 섞인 모양(-n 0을 빼먹은 경우)은 줄의 숫자 개수가 달라 읽지 않는다.
  expect(parseIostat('   38.44  799 29.98  20 13 67  7.09 7.65 6.94')).toBeNull()
})
