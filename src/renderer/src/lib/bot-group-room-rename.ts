import { toast } from 'sonner'
import { findBotGroupRoom } from '../../../shared/bots/bot-group'
import { botErrorMessage } from '@/components/bots/bot-presentation'
import { readBotGroups } from './bot-group-catalog-snapshot'
import { botGroupRoomLabel } from './bot-group-room-label'
import { callBotRpc } from './bot-hosts'

/** Renames a room on its group's host: a thread's title, or the group's name for the original room.
 *  A failure shows a toast. The name the tab already shows sends nothing, so an untitled thread's
 *  "New thread" placeholder never becomes its title. */
export async function renameBotGroupRoom(roomId: string, name: string): Promise<void> {
  const place = findBotGroupRoom(readBotGroups(), roomId)
  if (!place || name === botGroupRoomLabel(place.group, place.threadId)) {
    return
  }
  const { group, threadId } = place
  try {
    await (threadId
      ? callBotRpc(group, 'bots.groups.renameThread', { groupId: group.id, threadId, title: name })
      : callBotRpc(group, 'bots.groups.update', {
          groupId: group.id,
          revision: group.revision,
          name
        }))
  } catch (error) {
    toast.error(botErrorMessage(error))
  }
}
