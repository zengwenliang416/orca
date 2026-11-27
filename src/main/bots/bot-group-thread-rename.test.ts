import { afterEach, expect, it, vi } from 'vitest'
import type { BotGroup } from '../../shared/bots/bot-group'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { RpcCallerIdentity } from '../runtime/rpc/callers/rpc-caller-identity'
import type { RpcContext } from '../runtime/rpc/core'
import { BOT_GROUP_METHODS } from '../runtime/rpc/methods/bot-groups'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import SyncDatabase from '../sqlite/sync-database'
import { runtimeBotGroups } from './bot-group-runtime'
import { chats } from './bot-group-member-chats.test-fixture'

const ROOM = 'bot-group-member-room'
const NOTES = 'bot-group-member-notes'
const PLAN = 'bot-group-member-plan'

const SAVED: BotGroup = {
  id: 'room-1',
  name: 'Release',
  hostId: 'local',
  revision: 1,
  folder: '/work/release',
  folderWorkspaceId: 'folder:release',
  createdAt: 0,
  members: [{ botId: 'bot-0', sessionId: ROOM }],
  threads: [
    { id: 'thread-notes', createdAt: 0, members: [{ botId: 'bot-0', sessionId: NOTES }] },
    {
      id: 'thread-plan',
      createdAt: 0,
      members: [{ botId: 'bot-0', sessionId: PLAN }],
      title: 'Plan'
    }
  ],
  replyMode: { kind: 'all' }
}

function host() {
  const db = new SyncDatabase(':memory:')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a rename reads the room store and the chat host, and announces the change.
  const runtime = {
    getOrchestrationDb: () => ({ db }),
    ensureStructuredAgentSessionHost: async () => undefined,
    notifyBotGroupsChanged: () => undefined
  } as unknown as OrcaRuntimeService
  const { store } = runtimeBotGroups(runtime)
  store.put(SAVED)
  const method = BOT_GROUP_METHODS.find((entry) => entry.name === 'bots.groups.renameThread')!
  const rename = (
    title: string,
    {
      caller = { kind: 'desktop' },
      threadId = 'thread-notes'
    }: { caller?: RpcCallerIdentity; threadId?: string } = {}
  ) =>
    method.handler(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method's own schema parsed these params.
      method.params!.parse({ groupId: SAVED.id, threadId, title }) as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads the runtime and the caller.
      { runtime, caller } as unknown as RpcContext
    )
  return { store, rename }
}

afterEach(() => setStructuredAgentSessionHost(null))

it("names one thread and its member chats on the owner's rename, and no other room", async () => {
  const { title } = chats({ [ROOM]: {}, [NOTES]: {}, [PLAN]: {} })
  const { store, rename } = host()
  await rename('Release notes')
  const saved = store.get(SAVED.id)
  expect([saved.revision, saved.name, saved.threads?.map((thread) => thread.title)]).toEqual([
    2,
    'Release',
    ['Release notes', 'Plan']
  ])
  await vi.waitFor(() =>
    expect([ROOM, NOTES, PLAN].map(title)).toEqual(['Release', 'Release notes', 'Plan'])
  )
  await rename('Release notes')
  expect(store.get(SAVED.id).revision).toBe(2)
})

it('writes nothing for a caller that is not the owner, or a thread the group lacks', async () => {
  const { store, rename } = host()
  await expect(rename('Release notes', { caller: { kind: 'local-cli' } })).rejects.toThrow(
    'Use the group chat as its human owner.'
  )
  await expect(rename('Release notes', { threadId: 'thread-gone' })).rejects.toThrow(
    'This thread is no longer in the group.'
  )
  expect(store.get(SAVED.id)).toEqual(SAVED)
})
