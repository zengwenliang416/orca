import type { Tab } from '../../../../shared/workspace-layout/tab-groups/tab-types'

/** Why a title can't be set on this tab, or null: a group room's name is its group's, changed only
 *  by `bots.groups.renameThread` and `bots.groups.update`. */
export function roomTabTitleRefusal(
  tabs: readonly Tab[] | undefined,
  tabId: string,
  customTitle: string | null | undefined
): string | null {
  if (customTitle === undefined) {
    return null
  }
  const room = tabs?.some((tab) => tab.id === tabId && tab.contentType === 'room')
  return room
    ? "A group room's tab takes its name from the group: rename the thread or the group instead"
    : null
}
