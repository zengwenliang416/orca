import { afterEach, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'
import { setRuntimeDesktopSurface } from '../../construction/runtime-desktop-surface'
import {
  setupLayoutOwnerRuntime,
  WORKTREE_ID
} from '../../terminal/layout/orca-runtime-layout-owner-start-fixture'

function tab(id: string, contentType: Tab['contentType']): Tab {
  return {
    id,
    entityId: id,
    groupId: 'group-1',
    worktreeId: WORKTREE_ID,
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

afterEach(() => setRuntimeDesktopSurface(null))

it("keeps a group room's tab name off session.tabs.setTabProps, and renames other tabs as before", async () => {
  const { runtime, renameTerminal, session } = setupLayoutOwnerRuntime()
  setRuntimeDesktopSurface({
    showNotification: () => false,
    hasWindow: () => true,
    hasLiveRenderer: () => true,
    sendToWindow: () => true,
    requestRenderer: () => Promise.reject(new Error('unexpected renderer request'))
  })
  runtime.attachWindow(1)
  session().unifiedTabs = {
    [WORKTREE_ID]: [
      tab('room-tab', 'room'),
      tab('terminal-tab', 'terminal'),
      tab('chat-tab', 'agent-session')
    ]
  }
  const rename = (tabId: string) =>
    runtime.setMobileSessionTabProps(`id:${WORKTREE_ID}`, { tabId, customTitle: 'Renamed' })

  await expect(rename('room-tab')).rejects.toMatchObject({ code: 'capability_unsupported' })
  await expect(
    runtime.setMobileSessionTabProps(`id:${WORKTREE_ID}`, { tabId: 'room-tab', customTitle: null })
  ).rejects.toMatchObject({ code: 'capability_unsupported' })
  await rename('terminal-tab')
  await rename('chat-tab')
  expect(renameTerminal.mock.calls.map(([tabId, title]) => [tabId, title])).toEqual([
    ['terminal-tab', 'Renamed'],
    ['chat-tab', 'Renamed']
  ])
})
