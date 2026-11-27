import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'
import {
  setAgentSessionRecordUserName,
  type AgentSessionUserNameWrite
} from '../runtime/agent-session/records/agent-session-record-conversation-name'
import { botChatRecordRow } from '../runtime/rpc/methods/bots-chats'

/** Chat records as the host keeps them, named by the host's own write rule. */
export function chats(names: Record<string, Partial<AgentSessionRecord>>) {
  const records = new Map(
    Object.entries(names).map(([sessionId, fields]) => [
      sessionId,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: naming reads and writes only these fields.
      { sessionId, updatedAt: 0, ...fields } as AgentSessionRecord
    ])
  )
  const host = {
    deps: { store: { readOnly: false, getConversation: (id: string) => records.get(id) } },
    setUserConversationName: async (id: string, name: string, write: AgentSessionUserNameWrite) => {
      const record = records.get(id)
      if (record) {
        records.set(id, setAgentSessionRecordUserName(record, name, write, 1).record)
      }
      return null
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: naming uses only the store read and the name write.
  setStructuredAgentSessionHost(host as unknown as StructuredAgentSessionHost)
  /** The title `orca bot chats`, the row line and an item's Chat field show: the record's name. */
  const title = (id: string) =>
    botChatRecordRow(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a row reads the record's name and turn.
      records.get(id) as never,
      (sessionId) => sessionId,
      null
    )?.title
  return { title }
}
