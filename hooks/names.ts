import type { Proc } from '../types'

/**
 * 프로세스 이름(전체)을 pid로 읽는 명령입니다.
 * `top`은 이름을 16자에서 자르지만(`com.apple.Virtua`) `ps`의 `comm`은 실행 파일의 전체 경로를 줍니다.
 */
export function psArgv(pids: readonly number[]): string[] {
  return ['ps', '-p', pids.join(','), '-o', 'pid=,comm=']
}

/** 실행 파일의 경로에서 마지막 이름만 꺼냅니다(`/A/B/Aside Helper` → `Aside Helper`). */
export function baseName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

/** `ps -o pid=,comm=`의 출력("90070 /System/.../com.apple.Virtualization.VirtualMachine")을 pid별 이름으로 바꿉니다. */
export function parsePsNames(output: string): Map<number, string> {
  const names = new Map<number, string>()
  for (const line of output.split('\n')) {
    const row = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (!row) continue
    const name = baseName(row[2]!)
    if (name !== '') names.set(Number(row[1]), name)
  }
  return names
}

/** top이 자른 이름 대신 전체 이름을 씁니다. 전체 이름을 모르는 프로세스는 top의 이름 그대로 둡니다. */
export function withFullNames(procs: readonly Proc[], names: ReadonlyMap<number, string>): Proc[] {
  return procs.map(proc => ({ ...proc, command: names.get(proc.pid) ?? proc.command }))
}

/** 두 목록에 나온 프로세스의 pid를 겹치지 않게 모읍니다. */
export function uniquePids(...lists: readonly (readonly Proc[])[]): number[] {
  return [...new Set(lists.flat().map(proc => proc.pid))]
}

/** 자리가 모자라면 뒤를 `…`로 줄입니다. 줄였다는 것이 보이도록 일부러 한 글자를 `…`에 씁니다. */
export function fitName(name: string, width: number): string {
  const room = Math.max(1, Math.floor(width))
  if (name.length <= room) return name
  return room === 1 ? '…' : `${name.slice(0, room - 1)}…`
}
