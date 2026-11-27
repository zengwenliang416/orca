import { afterEach, describe, expect, it } from 'vitest'
import type { BotGroup } from '../../shared/bots/bot-group'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import SyncDatabase from '../sqlite/sync-database'
import type { BotGroupRuntime } from './bot-group-runtime'
import { BotGroupStore } from './bot-group-store'
import { nameBotGroupMemberChats } from './bot-group-member-chat-names'
import { chats } from './bot-group-member-chats.test-fixture'

const ROOM = 'bot-group-member-room'
const THREAD = 'bot-group-member-thread'
const PROMPT = 'You are responding in the shared group "Release"…'

function rooms(threadTitle?: string) {
  const store = new BotGroupStore(new SyncDatabase(':memory:'))
  const group: BotGroup = {
    id: 'room-1',
    name: 'Release',
    hostId: 'local',
    revision: 1,
    folder: '/work/release',
    folderWorkspaceId: 'folder:release',
    createdAt: 0,
    members: [{ botId: 'bot-0', sessionId: ROOM }],
    threads: [
      {
        id: 'thread-1',
        createdAt: 0,
        members: [{ botId: 'bot-0', sessionId: THREAD }],
        ...(threadTitle ? { title: threadTitle } : {})
      }
    ],
    replyMode: { kind: 'all' }
  }
  store.put(group)
  const runtime = { ensureStructuredAgentSessionHost: async () => undefined }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: naming reads the room store and the installed host.
  return { store, group, groups: { store, runtime } as unknown as BotGroupRuntime }
}

afterEach(() => setStructuredAgentSessionHost(null))

describe("a member chat's name", () => {
  it("is its room's name, a thread's title once it has one, not the room prompt", async () => {
    const { title } = chats({ [ROOM]: {}, [THREAD]: { conversationName: PROMPT } })
    const { groups, group, store } = rooms()
    await nameBotGroupMemberChats(groups, [group])
    expect([title(ROOM), title(THREAD)]).toEqual(['Release', 'Release'])
    const titled = { ...group, threads: group.threads!.map((t) => ({ ...t, title: 'Notes' })) }
    store.put({ ...titled, name: 'Ship' })
    // A pass handed the room as an earlier save left it still writes the room as saved now.
    await nameBotGroupMemberChats(groups, [group])
    expect([title(ROOM), title(THREAD)]).toEqual(['Ship', 'Notes'])
  })

  it('opens no chat host when there are no rooms to name', async () => {
    const store = new BotGroupStore(new SyncDatabase(':memory:'))
    const runtime = {
      ensureStructuredAgentSessionHost: async () => {
        throw new Error('opened the chat host')
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: naming reads the room store and the host.
    const groups = { store, runtime } as unknown as BotGroupRuntime
    await expect(nameBotGroupMemberChats(groups)).resolves.toBeUndefined()
  })

  it('names chats made before this on load, leaving one someone renamed', async () => {
    const { title } = chats({
      [ROOM]: { conversationName: PROMPT },
      [THREAD]: { conversationName: 'Mine', conversationNameSource: 'user' }
    })
    const { groups } = rooms('Notes')
    await nameBotGroupMemberChats(groups, undefined, { kept: true })
    expect([title(ROOM), title(THREAD)]).toEqual(['Release', 'Mine'])
  })
})
