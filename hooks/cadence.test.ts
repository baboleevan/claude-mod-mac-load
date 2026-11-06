import { expect, test } from 'claude-code/testing'

import { DEFAULT_INTERVAL, INTERVALS, isDue, isSlowerThanTarget, parseInterval, secondsLabel, waitMs } from './cadence'

test('고를 수 있는 주기는 2초·1초·0.5초이고 기본은 2초다', async () => {
  expect([...INTERVALS]).toEqual([2000, 1000, 500])
  expect(DEFAULT_INTERVAL).toBe(2000)
})

test('선택 창의 글자를 주기로 바꾸고, 목록에 없는 값은 거절한다', async () => {
  expect(parseInterval('500')).toBe(500)
  expect(parseInterval('1000')).toBe(1000)
  expect(parseInterval('2000')).toBe(2000)
  expect(parseInterval('300')).toBeNull()
  expect(parseInterval('')).toBeNull()
  expect(parseInterval('abc')).toBeNull()
})

test('재는 데 걸린 시간만큼은 기다리지 않고, 주기보다 오래 걸렸으면 바로 다음을 잰다', async () => {
  expect(waitMs(2000, 1010)).toBe(990)
  expect(waitMs(1000, 1010)).toBe(0)
  expect(waitMs(500, 1010)).toBe(0)
})

test('재는 중이 아니고 주기가 지났을 때만 다음 측정이 시작된다', async () => {
  expect(isDue({ isBusy: false, startedAt: 0, now: 2000, intervalMs: 2000 })).toBe(true)
  expect(isDue({ isBusy: false, startedAt: 0, now: 1999, intervalMs: 2000 })).toBe(false)
  expect(isDue({ isBusy: true, startedAt: 0, now: 9999, intervalMs: 500 })).toBe(false)
})

test('실제 간격이 목표보다 20% 넘게 느릴 때만 알린다', async () => {
  expect(isSlowerThanTarget(2000, 2050)).toBe(false)
  expect(isSlowerThanTarget(1000, 1100)).toBe(false)
  expect(isSlowerThanTarget(500, 1020)).toBe(true)
})

test('초 단위 글자를 만든다', async () => {
  expect(secondsLabel(1020)).toBe('1.0초')
  expect(secondsLabel(2000)).toBe('2.0초')
  expect(secondsLabel(500)).toBe('0.5초')
})
