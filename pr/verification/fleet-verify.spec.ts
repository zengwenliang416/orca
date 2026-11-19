import { mkdirSync, writeFileSync } from 'node:fs'
import { test } from '../desktop/electron-fixtures/orca-app'
import { expect, type Page } from '@stablyai/playwright-test'
import { postClaudeHook, readHookEndpoint } from '../agents/session-fixtures/agent-hook-endpoint'
import { runBuiltOrcaCli } from '../orchestration/completed-worker-retirement-fixture'
import {
  ensureTerminalVisible,
  waitForActiveWorktree,
  waitForSessionReady
} from '../desktop/renderer-probes/store'
import {
  execInTerminal,
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneCount
} from '../terminal/layout/terminal-pane-operations'
import { resolveActiveTabId } from '../terminal/layout/terminal-pane-identity'

const OUT = '/tmp/fleet-e2e'
const USE_FALLBACK = process.env.FLEET_E2E_FALLBACK === '1'

function log(label: string, value: unknown): void {
  console.log(`[fleet-e2e] ${label}: ${JSON.stringify(value, null, 2)}`)
}

function resultField(value: unknown, key: 'runId' | 'taskId'): string {
  const id = (value as { result?: Record<string, unknown> }).result?.[key]
  if (typeof id !== 'string') {
    throw new Error(`CLI result has no ${key}: ${JSON.stringify(value)}`)
  }
  return id
}

type Pane = { name: 'A' | 'B' | 'C'; paneKey: string; leafId: string; ptyId: string; handle?: string }

async function readPanes(page: Page): Promise<Omit<Pane, 'name'>[]> {
  const activeTab = await resolveActiveTabId(page)
  return page.evaluate((tabId) => {
    const state = window.__store!.getState()
    const manager = window.__paneManagers!.get(tabId as string)!
    const layout = state.terminalLayoutsByTabId[tabId as string]
    return (manager.getPanes?.() ?? []).map((pane: { leafId: string; container: HTMLElement }) => ({
      paneKey: `${tabId}:${pane.leafId}`,
      leafId: pane.leafId,
      ptyId: layout?.ptyIdsByLeafId?.[pane.leafId] ?? pane.container.dataset.ptyId ?? ''
    }))
  }, activeTab)
}

async function fleetTree(page: Page) {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll('section')].filter((s) =>
      s.querySelector(':scope > h3')
    )
    return sections.map((section) => {
      const header = section.querySelector(':scope > h3')!.textContent
      const nodes = [...section.querySelectorAll('button')].filter((b) => !b.closest('h3')).map((button) => {
        let depth = 0
        let parentText: string | null = null
        let li = button.closest('li')
        const ownLi = li
        while (li && section.contains(li)) {
          depth += 1
          li = li.parentElement?.closest('li') ?? null
          if (depth === 1 && li && section.contains(li)) {
            parentText = li.querySelector(':scope > button')?.textContent ?? null
          }
        }
        return {
          text: button.textContent,
          depth: ownLi ? depth : -1,
          parentText
        }
      })
      return { header, nodes }
    })
  })
}

async function fleetProjects(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('section')]
      .filter((s) => s.querySelector(':scope > h2'))
      .map((section) => ({
        header: section.querySelector(':scope > h2')!.textContent,
        expanded: section.querySelector(':scope > h2 button')?.getAttribute('aria-expanded'),
        locations: [...section.querySelectorAll('section:has(> h3) button')].filter((b) => !b.closest('h3')).map((b) => ({
          text: b.textContent,
          branchGlyph: Boolean(b.querySelector('svg.lucide-git-branch'))
        }))
      }))
  )
}

async function summaryBand(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('span.text-lg.tabular-nums')].map((value) => ({
      label: value.parentElement?.querySelector('.uppercase')?.textContent ?? null,
      value: Number(value.textContent)
    }))
  )
}

async function dialogInfo(page: Page) {
  return page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
      (d) => d.querySelector('h2')?.textContent !== 'Agents'
    )
    if (!dialog) {
      return null
    }
    const rows = [...dialog.querySelectorAll('.xterm-rows')].map((r) => r.textContent ?? '')
    return {
      title: dialog.querySelector('h2')?.textContent ?? null,
      text: (dialog.textContent ?? '').slice(0, 600),
      xterm: rows.join('\n').slice(0, 1200),
      ptyIds: [...dialog.querySelectorAll('[data-pty-id]')].map(
        (e) => (e as HTMLElement).dataset.ptyId
      )
    }
  })
}

function previewDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasNot: page.getByRole('heading', { name: 'Agents', exact: true }) })
}

async function closePreview(page: Page): Promise<void> {
  await previewDialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(previewDialog(page)).toHaveCount(0)
}

async function boardColumnCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const counts: Record<string, number> = {}
    for (const label of ['Needs You', 'Working', 'Done', 'Idle']) {
      const column = document.querySelector(`section[aria-label="${label}"]`)
      const badge = column?.querySelector(':scope > header > span.tabular-nums')
      if (badge) counts[label.toLowerCase()] = Number(badge.textContent)
    }
    return counts
  })
}

test('fleet view end to end', async ({ orcaPage: page, electronApp }) => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)

  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      experimentalAgentDashboardPopout: true,
      experimentalAgentDashboardShowIdle: true,
      uiLanguage: 'en'
    })
  })

  await splitActiveTerminalPane(page, 'vertical')
  await waitForPaneCount(page, 2, 20_000)
  await splitActiveTerminalPane(page, 'vertical')
  await waitForPaneCount(page, 3, 20_000)
  let raw: Omit<Pane, 'name'>[] = []
  await expect
    .poll(
      async () => {
        raw = await readPanes(page)
        return raw.filter((p) => p.ptyId).length
      },
      { timeout: 30_000 }
    )
    .toBe(3)
  const panes: Pane[] = raw.map((p, i) => ({ ...p, name: (['A', 'B', 'C'] as const)[i] }))
  for (const pane of panes) {
    await execInTerminal(page, pane.ptyId, `echo FLEET_MARKER_PANE_${pane.name}`)
  }
  log('panes', panes)

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const cwd = await page.evaluate(
    (id) =>
      Object.values(window.__store!.getState().worktreesByRepo)
        .flat()
        .find((w) => w.id === id)!.path,
    worktreeId
  )
  const cli = (args: string[]): unknown => {
    const result = runBuiltOrcaCli([...args, '--json'], { userDataDir, cwd })
    log(`cli ${args.slice(0, 2).join(' ')}`, result)
    return result
  }

  const terminals = cli(['terminal', 'list']) as unknown
  const summaries: { handle: string; leafId?: string; tabId?: string }[] = []
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(collect)
    } else if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>
      if (typeof r.handle === 'string' && typeof r.leafId === 'string') {
        summaries.push(r as { handle: string; leafId: string })
      }
      Object.values(r).forEach(collect)
    }
  }
  collect(terminals)
  for (const pane of panes) {
    pane.handle = summaries.find((s) => s.leafId === pane.leafId)?.handle
    expect(pane.handle, `handle for pane ${pane.name}`).toBeTruthy()
  }
  const [A, B, C] = panes

  const endpoint = await readHookEndpoint(electronApp)
  const prompts = { A: 'FLEET-A coordinate the team', B: 'FLEET-B review module', C: 'FLEET-C write tests' }
  const post = (pane: Pane, payload: Record<string, unknown>) =>
    postClaudeHook(endpoint, { paneKey: pane.paneKey, worktreeId }, {
      session_id: `fleet-e2e-${pane.name}`,
      ...payload
    })

  if (USE_FALLBACK) {
    throw new Error('fallback path not implemented yet')
  }

  // Real dispatch path: A -> B, then B -> C.
  const runA = resultField(
    cli(['orchestration', 'run-create', '--objective', 'Fleet e2e', '--from', A.handle!]),
    'runId'
  )
  const taskB = resultField(
    cli(['orchestration', 'task-create', '--spec', 'B work', '--task-title', 'FLEET-B task', '--run', runA, '--from', A.handle!]),
    'taskId'
  )
  cli(['orchestration', 'dispatch', '--task', taskB, '--to', B.handle!, '--run', runA, '--from', A.handle!])
  // A worker may not coordinate its own Run, so B opens a nested Run for C.
  const runB = resultField(
    cli(['orchestration', 'run-create', '--objective', 'Fleet e2e nested', '--from', B.handle!]),
    'runId'
  )
  const taskC = resultField(
    cli(['orchestration', 'task-create', '--spec', 'C work', '--task-title', 'FLEET-C task', '--run', runB, '--from', B.handle!]),
    'taskId'
  )
  cli(['orchestration', 'dispatch', '--task', taskC, '--to', C.handle!, '--run', runB, '--from', B.handle!])
  log('ids', { runA, taskB, runB, taskC })

  await post(A, { hook_event_name: 'UserPromptSubmit', prompt: prompts.A })
  await post(B, { hook_event_name: 'UserPromptSubmit', prompt: prompts.B })
  await post(C, { hook_event_name: 'UserPromptSubmit', prompt: prompts.C })
  await post(B, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build' }
  })
  await post(C, { hook_event_name: 'Stop', last_assistant_message: 'C finished' })

  const statusOf = () =>
    page.evaluate(
      (keys) => {
        const s = window.__store!.getState() as unknown as {
          agentStatusByPaneKey: ReadonlyMap<string, { state: string; orchestration?: { parentPaneKey?: string } }>
        }
        return keys.map((k) => ({
          paneKey: k,
          state: s.agentStatusByPaneKey.get(k)?.state ?? null,
          parent: s.agentStatusByPaneKey.get(k)?.orchestration?.parentPaneKey ?? null
        }))
      },
      panes.map((p) => p.paneKey)
    )
  await expect
    .poll(async () => (await statusOf()).map((s) => s.state), { timeout: 15_000 })
    .toEqual(['working', 'waiting', 'done'])
  await expect
    .poll(async () => (await statusOf()).map((s) => s.parent), { timeout: 15_000 })
    .toEqual([null, A.paneKey, B.paneKey])
  log('store status', await statusOf())

  await page.evaluate(() => {
    const s = window.__store!.getState()
    s.setSidebarOpen(true)
    s.setAgentDashboardDrawerOpen(true)
  })
  const toggle = page.getByRole('radiogroup', { name: 'Dashboard view' })
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(prompts.A).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)

  // Check 1: board
  await page.screenshot({ path: `${OUT}/01-board-view.png` })
  const boardColumns = await page.evaluate(() =>
    [...document.querySelectorAll('section, div')]
      .map((e) => e.getAttribute('aria-label'))
      .filter((v): v is string => Boolean(v))
  )
  log('board aria-labels', boardColumns)

  // Board card click on C to capture the reference dialog.
  await page.getByRole('button').filter({ hasText: 'FLEET-C' }).first().click()
  await expect(previewDialog(page)).toBeVisible()
  const boardDialog = await dialogInfo(page)
  log('board dialog for C', boardDialog)
  await page.screenshot({ path: `${OUT}/02-board-dialog-C.png` })
  await closePreview(page)
  const boardCounts = await boardColumnCounts(page)
  log('board column counts before fleet', boardCounts)

  // Check 2: fleet
  const items = toggle.locator('button')
  log('toggle items', await items.evaluateAll((els) => els.map((e) => ({ text: e.textContent, role: e.getAttribute('role'), checked: e.getAttribute('aria-checked'), pressed: e.getAttribute('aria-pressed'), state: e.getAttribute('data-state') }))))
  await toggle.getByRole('radio', { name: 'Fleet' }).click()
  await expect(page.getByText('Teams', { exact: false }).first()).toBeVisible()
  await page.waitForTimeout(300)
  const tree = await fleetTree(page)
  const summary = await summaryBand(page)
  log('fleet tree', tree)
  log('fleet summary', summary)
  writeFileSync(`${OUT}/fleet-dom.json`, JSON.stringify({ tree, summary }, null, 2))
  await page.screenshot({ path: `${OUT}/03-fleet-view.png` })
  expect(tree).toHaveLength(1)
  const projects = await fleetProjects(page)
  log('fleet projects', projects)
  expect(projects).toHaveLength(1)
  expect(projects[0].header).toContain('orca-e2e-repo')
  expect(projects[0].header).toContain('3 agents')
  expect(projects[0].expanded).toBe('true')
  expect(projects[0].locations).toHaveLength(3)
  for (const location of projects[0].locations) {
    expect(location.text).toContain('main')
    expect(location.branchGlyph).toBe(true)
  }
  const nodes = tree[0].nodes
  const byMarker = (m: string) => nodes.find((n) => n.text?.includes(m))
  expect(byMarker('FLEET-A')?.depth).toBe(1)
  expect(byMarker('FLEET-B')?.depth).toBe(2)
  expect(byMarker('FLEET-B')?.parentText).toContain('FLEET-A')
  expect(byMarker('FLEET-C')?.depth).toBe(3)
  expect(byMarker('FLEET-C')?.parentText).toContain('FLEET-B')
  const tile = (label: string) => summary.find((t) => t.label?.toLowerCase() === label)?.value
  expect(tile('agents')).toBe(3)
  expect(tile('teams')).toBe(1)
  expect(tile('projects')).toBe(1)
  const fleetBuckets = {
    'needs you': tile('needs you'),
    working: tile('working'),
    done: tile('done'),
    idle: tile('idle')
  }
  log('fleet bucket tiles vs board columns', { fleetBuckets, boardCounts })
  expect(fleetBuckets).toEqual({
    'needs you': boardCounts['needs you'],
    working: boardCounts.working,
    done: boardCounts.done,
    idle: boardCounts.idle
  })

  // Check 3: fleet node click opens the same dialog
  await page
    .locator('section:has(> h3)')
    .getByRole('button')
    .filter({ hasText: 'FLEET-C' })
    .click()
  await expect(previewDialog(page)).toBeVisible()
  const fleetDialog = await dialogInfo(page)
  log('fleet dialog for C', fleetDialog)
  await page.screenshot({ path: `${OUT}/04-fleet-dialog-C.png` })
  expect(fleetDialog?.title).toBe(boardDialog?.title)
  expect(fleetDialog?.ptyIds).toEqual(boardDialog?.ptyIds)
  const paneMarkers = (info: Awaited<ReturnType<typeof dialogInfo>>) =>
    ['A', 'B', 'C'].filter((n) => `${info?.text}\n${info?.xterm}`.includes(`FLEET_MARKER_PANE_${n}`))
  log('dialog pane markers', { board: paneMarkers(boardDialog), fleet: paneMarkers(fleetDialog) })
  expect(paneMarkers(boardDialog)).toEqual(['C'])
  expect(paneMarkers(fleetDialog)).toEqual(['C'])
  await closePreview(page)

  // Check 4: keyboard
  const fleetItem = toggle.getByRole('radio', { name: 'Fleet' })
  const boardItem = toggle.getByRole('radio', { name: 'Board' })
  await fleetItem.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(boardItem).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(boardItem).toHaveAttribute('aria-checked', 'true')
  const afterEnter = (await fleetTree(page)).length
  await page.keyboard.press('ArrowRight')
  await expect(fleetItem).toBeFocused()
  await page.keyboard.press('Space')
  await expect(fleetItem).toHaveAttribute('aria-checked', 'true')
  const afterSpace = (await fleetTree(page)).length
  log('keyboard', { afterEnterTeams: afterEnter, afterSpaceTeams: afterSpace })
  expect(afterEnter).toBe(0)
  expect(afterSpace).toBe(1)
  await page.screenshot({ path: `${OUT}/05-keyboard-back-to-fleet.png` })

  // Check 4b: closing and reopening the dashboard keeps the view and the collapsed project
  const projectToggle = page.locator('section:has(> h2) > h2 button').first()
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'true')
  await projectToggle.click()
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'false')
  const setDrawer = (open: boolean) =>
    page.evaluate((value) => window.__store!.getState().setAgentDashboardDrawerOpen(value), open)
  await setDrawer(false)
  await expect(toggle).toBeHidden({ timeout: 15_000 })
  await setDrawer(true)
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(fleetItem).toHaveAttribute('aria-checked', 'true')
  const reopenedProject = page.locator('section:has(> h2) > h2 button').first()
  await expect(reopenedProject).toHaveAttribute('aria-expanded', 'false')
  log('reopen', {
    view: await fleetItem.getAttribute('aria-checked'),
    project: await reopenedProject.getAttribute('aria-expanded')
  })
  await page.screenshot({ path: `${OUT}/05b-reopened-remembers.png` })
  await reopenedProject.click()
  await expect(reopenedProject).toHaveAttribute('aria-expanded', 'true')

  // Check 5: back to board
  await boardItem.click()
  await expect(page.getByRole('button').filter({ hasText: 'FLEET-A' }).first()).toBeVisible()
  expect((await fleetTree(page)).length).toBe(0)
  await page.screenshot({ path: `${OUT}/06-board-again.png` })

  // Check 6: pop-out, hidden
  const before = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), title: w.getTitle() }))
  )
  await page.evaluate(() => window.api.dashboard.openPopout())
  let popout: Page | null = null
  await expect
    .poll(
      async () => {
        popout = electronApp.windows().find((w) => w.url().includes('popout')) ?? null
        return popout !== null
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  const after = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), title: w.getTitle() }))
  )
  log('windows', { before, after })
  const pop = popout as unknown as Page
  await pop.waitForLoadState('domcontentloaded')
  const popToggle = pop.getByRole('radiogroup', { name: 'Dashboard view' })
  await expect(popToggle).toBeVisible({ timeout: 20_000 })
  await expect(pop.getByText(prompts.A).first()).toBeVisible({ timeout: 15_000 })
  await pop.screenshot({ path: `${OUT}/07-popout-board.png` })
  await popToggle.getByRole('radio', { name: 'Fleet' }).click()
  await pop.waitForTimeout(300)
  const popTree = await fleetTree(pop)
  log('popout fleet tree', popTree)
  await pop.screenshot({ path: `${OUT}/08-popout-fleet.png` })
  expect(popTree).toHaveLength(1)
  await pop
    .locator('section:has(> h3)')
    .getByRole('button')
    .filter({ hasText: 'FLEET-C' })
    .click()
  await expect(previewDialog(pop)).toBeVisible()
  log('popout dialog for C', await dialogInfo(pop))
  await pop.screenshot({ path: `${OUT}/09-popout-fleet-dialog-C.png` })
  const final = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), title: w.getTitle() }))
  )
  log('windows final', final)
  expect(final.every((w) => !w.visible)).toBe(true)
})
