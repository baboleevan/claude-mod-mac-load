import { expect, test } from 'claude-code/testing'

import type { Proc } from '../types'
import { baseName, fitName, parsePsNames, psArgv, uniquePids, withFullNames } from './names'

// `ps -p ... -o pid=,comm=`의 출력입니다. 이름에 공백이 있는 앱과 아주 긴 이름이 섞여 있습니다.
const PS = `  133 /usr/libexec/smd
90070 /System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine
84844 /Applications/Aside.app/Contents/Frameworks/Aside Framework.framework/Versions/1/Helpers/Aside Helper.app/Contents/MacOS/Aside Helper
    1 kernel_task
`

test('pid를 쉼표로 이어 ps에 넘긴다', async () => {
  expect(psArgv([1, 22, 333])).toEqual(['ps', '-p', '1,22,333', '-o', 'pid=,comm='])
})

test('경로의 마지막 이름만 꺼낸다', async () => {
  expect(baseName('/usr/libexec/smd')).toBe('smd')
  expect(baseName('/A/B/Aside Helper')).toBe('Aside Helper')
  expect(baseName('kernel_task')).toBe('kernel_task')
  expect(baseName('/A/B/')).toBe('B')
})

test('ps 출력에서 pid별 전체 이름을 읽는다(top이 자른 이름도 온전히)', async () => {
  const names = parsePsNames(PS)
  expect(names.get(90070)).toBe('com.apple.Virtualization.VirtualMachine')
  expect(names.get(84844)).toBe('Aside Helper')
  expect(names.get(133)).toBe('smd')
  expect(names.get(1)).toBe('kernel_task')
  expect(parsePsNames('').size).toBe(0)
  expect(parsePsNames('ps: no such process').size).toBe(0)
})

const proc = (pid: number, command: string): Proc => ({ pid, command, cpu: 1, mem: '1M' })

test('전체 이름을 아는 프로세스만 바꾸고 나머지는 top의 이름을 둔다', async () => {
  const names = parsePsNames(PS)
  const result = withFullNames([proc(90070, 'com.apple.Virtua'), proc(999, 'gone')], names)
  expect(result.map(p => p.command)).toEqual(['com.apple.Virtualization.VirtualMachine', 'gone'])
  // 다른 값은 건드리지 않는다.
  expect(result[0]).toMatchObject({ pid: 90070, cpu: 1, mem: '1M' })
})

test('두 목록의 pid를 겹치지 않게 모은다', async () => {
  expect(uniquePids([proc(1, 'a'), proc(2, 'b')], [proc(2, 'b'), proc(3, 'c')])).toEqual([1, 2, 3])
})

test('자리가 모자라면 …로 줄이고, 넉넉하면 그대로 둔다', async () => {
  expect(fitName('com.apple.Virtualization.VirtualMachine', 60)).toBe('com.apple.Virtualization.VirtualMachine')
  expect(fitName('com.apple.Virtualization.VirtualMachine', 20)).toBe('com.apple.Virtualiz…')
  expect(fitName('abc', 3)).toBe('abc')
  expect(fitName('abcd', 3)).toBe('ab…')
  expect(fitName('abcd', 1)).toBe('…')
  expect(fitName('abcd', 0)).toBe('…')
})
