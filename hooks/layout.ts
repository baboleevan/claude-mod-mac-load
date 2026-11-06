/**
 * 보여 주는 자리입니다.
 * - `pane`: 창. Claude Code가 화면 환경에 따라 정합니다(전체 화면에 폭 110칸 이상이면 대화 오른쪽, 아니면 프롬프트 위).
 * - `band`: 프롬프트 바로 위의 띠. 터미널 폭과 상관없이 항상 아래쪽입니다.
 */
export const POSITIONS = ['pane', 'band'] as const

export type Position = (typeof POSITIONS)[number]

/** 처음 쓰는 위치입니다. */
export const DEFAULT_POSITION: Position = 'pane'

/** 선택 창에 보이는 이름입니다. */
export const POSITION_LABEL: Record<Position, string> = {
  pane: '오른쪽 창',
  band: '아래쪽 띠',
}

/** 선택 창이 돌려준 글자를 위치로 바꿉니다. 고를 수 없는 값이면 null입니다. */
export function parsePosition(value: string): Position | null {
  return POSITIONS.find(position => position === value) ?? null
}

/** 모든 내용(그래프와 프로세스 목록 두 개)을 펼쳐 그리는 데 드는 줄 수입니다. */
export const FULL_ROWS = 30

/** 막대·그래프·부하 평균만 그리는 데 드는 줄 수입니다(선택 창 둘과 갱신 간격 줄 포함). */
export const COMPACT_ROWS = 10

/**
 * - `full`: 전부(막대, 그래프, 프로세스 목록 두 개)
 * - `compact`: 막대·그래프·부하 평균만
 * - `mini`: 한 줄 요약만
 */
export type Layout = 'full' | 'compact' | 'mini'

/**
 * 자리에 맞는 모양을 고릅니다.
 * 띠는 프롬프트 위의 남는 자리만큼만 쓸 수 있어서, 자리가 모자라면 줄이고, 아주 좁으면 한 줄로 줄입니다.
 * 창은 스스로 스크롤하므로 줄이지 않습니다.
 */
export function layoutFor(position: Position, maxRows: number): Layout {
  if (position === 'pane' || maxRows >= FULL_ROWS) return 'full'
  return maxRows >= COMPACT_ROWS ? 'compact' : 'mini'
}

/** 띠를 고른 뒤 이 시간(ms) 안에 한 번도 그려지지 않으면 그릴 수 없는 화면으로 보고 창으로 되돌립니다. */
export const BAND_GRACE_MS = 5000

/** 띠를 고른 시각(`since`) 이후 한 번도 그려지지 않은 채 유예 시간이 지났는지입니다. */
export function isBandMissing(options: { since: number; seenAt: number; now: number }): boolean {
  return options.since > 0 && options.seenAt < options.since && options.now - options.since >= BAND_GRACE_MS
}
