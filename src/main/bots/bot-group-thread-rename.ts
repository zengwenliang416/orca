import type { z } from 'zod'
import type { BotGroup, BotGroupRenameThread } from '../../shared/bots/bot-group'
import { runKeyedSerializedOperation } from '../../shared/concurrency/keyed-serialized-operations'
import type { BotGroupRuntime } from './bot-group-runtime'

/** Saves `title` as the thread's name and returns the group: an unchanged title saves nothing, a
 *  thread no longer in the group throws. */
export function renameBotGroupThread(
  groups: BotGroupRuntime,
  input: z.infer<typeof BotGroupRenameThread>
): Promise<BotGroup> {
  return runKeyedSerializedOperation(groups.queues, input.groupId, async () => {
    const previous = groups.store.get(input.groupId)
    const thread = previous.threads?.find((entry) => entry.id === input.threadId)
    if (!thread) {
      throw new Error('This thread is no longer in the group.')
    }
    if (thread.title === input.title) {
      return previous
    }
    const group: BotGroup = {
      ...previous,
      revision: previous.revision + 1,
      threads: previous.threads?.map((entry) =>
        entry === thread ? { ...entry, title: input.title } : entry
      )
    }
    groups.store.put(group)
    groups.changed()
    return groups.named(group)
  })
}
