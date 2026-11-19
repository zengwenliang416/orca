// Unreported diagnostic: CPU-profile one update run per side and list self time by source file.
// Usage: node profile-updates.mjs --repo <orca checkout> [--side Fleet|Board] [--ticks 20] [--browser <path> | --channel <name>]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1] }
const repo = path.resolve(arg('repo'))
const require = createRequire(path.join(repo, 'package.json'))
const { chromium } = require('playwright-core')
const url = arg('url') ?? JSON.parse(readFileSync(path.join(repo, '.cache/fixtures/server.json'), 'utf8')).url
const launch = arg('browser') ? { executablePath: arg('browser') } : arg('channel') ? { channel: arg('channel') } : {}
const browser = await chromium.launch({ headless: true, ...launch })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await page.goto(`${url}/fixtures.html?worker=1`)
await page.waitForFunction(() => Boolean(window.__orcaComponentFixtureHost))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
for (const side of (arg('side') ? [arg('side')] : ['Fleet', 'Board'])) {
  await page.evaluate((id) => window.__orcaComponentFixtureHost.render(id, 'dark'), `dashboard/fleet/AgentDashboardScale:scale300${side}Updates`)
  await page.waitForFunction(() => document.documentElement.dataset.fixtureState === 'ready')
  await page.waitForTimeout(500)
  await page.evaluate(() => { window.__fleetPerf.ticks.length = 0 })
  await cdp.send('Profiler.start')
  const ticks = Number(arg('ticks', '20'))
  await page.waitForFunction((n) => window.__fleetPerf.ticks.length >= n, ticks, { timeout: 120000, polling: 50 })
  const { profile } = await cdp.send('Profiler.stop')
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const name = (n) => n.callFrame.functionName || `(${n.callFrame.url ? 'anon' : 'program'})`
  const self = new Map()
  const incl = new Map()
  const dt = profile.timeDeltas
  profile.samples.forEach((id, i) => {
    const ms = (dt[i] ?? 0) / 1000
    const node = byId.get(id)
    self.set(name(node), (self.get(name(node)) ?? 0) + ms)
    const seen = new Set()
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const fn = name(byId.get(cur))
      if (!seen.has(fn)) { seen.add(fn); incl.set(fn, (incl.get(fn) ?? 0) + ms) }
    }
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const tickMs = await page.evaluate(() => window.__fleetPerf.ticks.reduce((a, t) => a + t.flushMs, 0))
  console.log(`\n${side}: profiled ${total.toFixed(0)} ms wall, ${tickMs.toFixed(0)} ms inside ticks`)
  console.log('-- self time')
  for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${key}`)
  console.log('-- inclusive time, app and library components')
  const interesting = /^(Fleet|Dashboard|Agent|Collapsible|Presence|Primitive|Slot|Tooltip|HoverCard|RepoIcon|StatusIndicator|buildFleetView|buildAgentRowLineageTree|toNode|fleet|dashboard|formatSubagent|useTranslate|t$|translate)/
  for (const [key, ms] of [...incl].filter(([k]) => interesting.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${key}`)
}
await browser.close()
