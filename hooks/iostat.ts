/** `iostat`을 한 번 읽은 값입니다. */
export type IostatReading = {
  cpu: { user: number; sys: number; idle: number }
  load: [number, number, number]
}

/**
 * 1초 동안의 CPU 사용률과 부하 평균을 가볍게(CPU를 거의 쓰지 않고) 읽는 명령입니다.
 * `-c 2 -w 1`은 두 번 출력하고, 첫 줄은 부팅 이후 평균이라 두 번째 줄(직전 1초)만 씁니다.
 * `-n 0`은 디스크 열을 빼서 줄 모양을 "us sy id 1m 5m 15m"로 고정합니다.
 */
export const IOSTAT_ARGV = ['iostat', '-n', '0', '-c', '2', '-w', '1'] as const

/** 마지막 숫자 줄("20 13 67  5.16 7.01 6.75")을 읽습니다. 읽을 수 없으면 null입니다. */
export function parseIostat(output: string): IostatReading | null {
  const rows = output
    .split('\n')
    .map(line => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/.exec(line))
    .filter((row): row is RegExpExecArray => row !== null)
  const row = rows[rows.length - 1]
  if (!row) return null
  return {
    cpu: { user: Number(row[1]), sys: Number(row[2]), idle: Number(row[3]) },
    load: [Number(row[4]), Number(row[5]), Number(row[6])],
  }
}
