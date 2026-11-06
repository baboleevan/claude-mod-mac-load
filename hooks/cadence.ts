/** 고를 수 있는 갱신 주기(ms)입니다. 앞의 것이 기본값이 아니라 화면에 보이는 순서입니다. */
export const INTERVALS = [2000, 1000, 500] as const

export type IntervalMs = (typeof INTERVALS)[number]

/** 처음 쓰는 갱신 주기입니다. */
export const DEFAULT_INTERVAL: IntervalMs = 2000

/** 선택 창에 보이는 이름입니다. */
export const INTERVAL_LABEL: Record<IntervalMs, string> = {
  2000: '2초',
  1000: '1초',
  500: '0.5초',
}

/** 선택 창이 돌려준 글자("1000")를 주기로 바꿉니다. 고를 수 없는 값이면 null입니다. */
export function parseInterval(value: string): IntervalMs | null {
  const ms = Number(value)
  return INTERVALS.find(interval => interval === ms) ?? null
}

/** 사람이 읽는 초 단위 글자입니다(1500 → "1.5초"). */
export function secondsLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`
}

/**
 * 한 번 재는 데 `elapsedMs`가 걸렸을 때, 다음 측정을 시작할 때까지 더 기다릴 시간입니다.
 * 재는 데 주기보다 오래 걸렸으면 기다리지 않고 바로 다음을 잽니다(0).
 */
export function waitMs(intervalMs: number, elapsedMs: number): number {
  return Math.max(0, intervalMs - elapsedMs)
}

/** 다음 측정을 시작할 때가 됐는지입니다. 이미 재는 중이면 겹쳐 재지 않습니다. */
export function isDue(options: { isBusy: boolean; startedAt: number; now: number; intervalMs: number }): boolean {
  return !options.isBusy && options.now - options.startedAt >= options.intervalMs
}

/**
 * 실제 간격이 고른 주기보다 눈에 띄게(20% 넘게) 느린지입니다.
 * 맥에서는 CPU를 1초보다 짧게 잴 수 없어, 0.5초를 골라도 실제로는 약 1초마다 갱신됩니다.
 */
export function isSlowerThanTarget(targetMs: number, actualMs: number): boolean {
  return actualMs > targetMs * 1.2
}
