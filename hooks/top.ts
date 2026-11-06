import type { Proc } from '../types'

/** 화면에 보여 줄 상위 프로세스 개수입니다. */
export const TOP_COUNT = 5

/** `top`을 한 번 읽은 값입니다. */
export type TopReading = {
  cpu: { user: number; sys: number; idle: number }
  load: [number, number, number]
  mem: { usedGb: number; totalGb: number; wiredGb: number; compressedGb: number }
  /** CPU를 많이 쓰는 순서의 상위 프로세스입니다. */
  procs: Proc[]
  /** 메모리를 많이 쓰는 순서의 상위 프로세스입니다. */
  memProcs: Proc[]
}

/** top이 쓰는 크기 단위를 GB로 바꾸는 비율입니다. */
const GB_PER_UNIT: Record<string, number> = { K: 1 / 1024 / 1024, M: 1 / 1024, G: 1, T: 1024 }

function toGb(value: string, unit: string | undefined): number {
  return Number(value) * (GB_PER_UNIT[unit ?? 'M'] ?? 0)
}

/** 프로세스 열의 메모리("2266M-", "17G", "512K+")를 GB로 바꿉니다. 뒤의 +/-는 증감 표시라 버립니다. */
function memGbOf(mem: string): number {
  const match = /^([\d.]+)([KMGT])?/.exec(mem)
  return match ? toGb(match[1]!, match[2]) : 0
}

/**
 * `top -l 2 -s 1 -o cpu -stats pid,command,cpu,mem`의 출력을 읽습니다.
 * 첫 표본은 부팅 이후 평균이라 쓰지 않고, 마지막 표본(직전 1초 동안의 값)만 읽습니다.
 * `-n`을 주지 않아 모든 프로세스가 나오므로, 같은 출력에서 CPU 순과 메모리 순 상위를 각각 뽑습니다.
 * 읽을 수 없는 모양이면 null입니다.
 */
export function parseTop(output: string, count: number = TOP_COUNT): TopReading | null {
  const blocks = output.split(/^Processes:/m)
  const block = blocks.length >= 2 ? blocks[blocks.length - 1] : undefined
  if (!block) return null

  const cpu = /CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/.exec(block)
  const load = /Load Avg:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(block)
  const mem =
    /PhysMem:\s*([\d.]+)([KMGT]) used \(([\d.]+)([KMGT]) wired(?:, ([\d.]+)([KMGT]) compressor)?\),\s*([\d.]+)([KMGT]) unused/.exec(
      block,
    )
  if (!cpu || !load || !mem) return null

  const usedGb = toGb(mem[1]!, mem[2])
  const unusedGb = toGb(mem[7]!, mem[8])

  const all: Proc[] = []
  const lines = block.split('\n')
  const header = lines.findIndex(line => /^PID\s+COMMAND/.test(line))
  if (header >= 0) {
    for (const line of lines.slice(header + 1)) {
      if (line.trim() === '') break
      const row = /^\s*(\d+)\s+(.+?)\s+([\d.]+)\s+(\S+)\s*$/.exec(line)
      if (row) all.push({ pid: Number(row[1]), command: row[2]!, cpu: Number(row[3]), mem: row[4]! })
    }
  }
  // 값이 같으면 pid가 작은 쪽을 앞에 두어 새로 읽을 때마다 순서가 흔들리지 않게 합니다.
  const procs = [...all].sort((a, b) => b.cpu - a.cpu || a.pid - b.pid).slice(0, count)
  const memProcs = [...all]
    .sort((a, b) => memGbOf(b.mem) - memGbOf(a.mem) || a.pid - b.pid)
    .slice(0, count)

  return {
    cpu: { user: Number(cpu[1]), sys: Number(cpu[2]), idle: Number(cpu[3]) },
    load: [Number(load[1]), Number(load[2]), Number(load[3])],
    mem: {
      usedGb,
      // top은 전체 용량을 따로 주지 않아 쓰는 양과 남은 양을 더해 구합니다.
      totalGb: usedGb + unusedGb,
      wiredGb: toGb(mem[3]!, mem[4]),
      compressedGb: mem[5] ? toGb(mem[5], mem[6]) : 0,
    },
    procs,
    memProcs,
  }
}

/** `memory_pressure -Q`의 "System-wide memory free percentage: 68%"에서 여유율(%)을 읽습니다. */
export function parseFreePercent(output: string): number | null {
  const match = /free percentage:\s*(\d+)%/.exec(output)
  return match ? Number(match[1]) : null
}
