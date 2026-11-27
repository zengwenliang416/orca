import { expect, it } from 'vitest'
import { BotGroupRenameThread } from './bot-group'

const title = (text: string) =>
  BotGroupRenameThread.safeParse({ groupId: 'group-1', threadId: 'thread-1', title: text }).data
    ?.title

it("takes a thread's new name as one line of at most 80 characters, whole characters and no edge spaces, never blank", () => {
  expect(title('  Release\n\n notes\t')).toBe('Release notes')
  expect(title('n'.repeat(81))).toBe(
    'nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn'
  )
  expect(title(`${'a'.repeat(79)} bbb`)).toBe('a'.repeat(79))
  expect(title(`${'a'.repeat(79)}😀`)).toBe('a'.repeat(79))
  expect(title(`${'a'.repeat(78)}😀`)).toBe(`${'a'.repeat(78)}😀`)
  expect(title(' \n\t ')).toBeUndefined()
})
