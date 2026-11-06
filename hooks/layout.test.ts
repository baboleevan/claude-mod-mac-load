import { expect, test } from 'claude-code/testing'

import {
  BAND_GRACE_MS,
  COMPACT_ROWS,
  DEFAULT_POSITION,
  FULL_ROWS,
  POSITIONS,
  isBandMissing,
  layoutFor,
  parsePosition,
} from './layout'

test('고를 수 있는 위치는 창과 띠이고 기본은 창이다', async () => {
  expect([...POSITIONS]).toEqual(['pane', 'band'])
  expect(DEFAULT_POSITION).toBe('pane')
})

test('선택 창의 글자를 위치로 바꾸고, 목록에 없는 값은 거절한다', async () => {
  expect(parsePosition('pane')).toBe('pane')
  expect(parsePosition('band')).toBe('band')
  expect(parsePosition('left')).toBeNull()
  expect(parsePosition('')).toBeNull()
})

test('띠는 자리에 맞춰 전부 → 줄여서 → 한 줄로 줄고, 창은 줄이지 않는다', async () => {
  expect(layoutFor('band', FULL_ROWS)).toBe('full')
  expect(layoutFor('band', FULL_ROWS - 1)).toBe('compact')
  expect(layoutFor('band', COMPACT_ROWS)).toBe('compact')
  expect(layoutFor('band', COMPACT_ROWS - 1)).toBe('mini')
  expect(layoutFor('band', 0)).toBe('mini')
  expect(layoutFor('pane', 3)).toBe('full')
})

test('띠를 고른 뒤 유예 시간이 지나도 한 번도 그려지지 않았을 때만 없는 것으로 본다', async () => {
  const since = 10_000
  // 아직 유예 시간 안.
  expect(isBandMissing({ since, seenAt: 0, now: since + BAND_GRACE_MS - 1 })).toBe(false)
  // 유예 시간이 지났는데 그려진 적이 없다.
  expect(isBandMissing({ since, seenAt: 0, now: since + BAND_GRACE_MS })).toBe(true)
  // 고른 뒤에 한 번이라도 그려졌다.
  expect(isBandMissing({ since, seenAt: since + 100, now: since + BAND_GRACE_MS * 3 })).toBe(false)
  // 띠를 고르지 않았다(since 0).
  expect(isBandMissing({ since: 0, seenAt: 0, now: 999_999 })).toBe(false)
})
