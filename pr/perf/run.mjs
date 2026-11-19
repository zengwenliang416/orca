// Fleet vs Board render/update benchmark against Orca's component fixture server.
// Usage: node run.mjs --repo <orca checkout> [--out <dir>] [--url <fixture server url>]
//        [--sizes 100,300] [--runs 5] [--ticks 40] [--browser <chromium path> | --channel <chrome|msedge>]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = {
    out: path.dirname(fileURLToPath(import.meta.url)),
    sizes: '100,300',
    runs: '5',
    ticks: '40',
    theme: 'dark'
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!key.startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Bad argument near "${key}". See the usage line at the top of run.mjs.`)
    }
    args[key.slice(2)] = argv[index + 1]
  }
  if (!args.repo) {
    throw new Error('--repo <path to the orca checkout> is required')
  }
  return {
    repo: path.resolve(args.repo),
    out: path.resolve(args.out),
    url: args.url,
    sizes: args.sizes.split(',').map(Number),
    runs: Number(args.runs),
    ticks: Number(args.ticks),
    theme: args.theme,
    browser: args.browser,
    channel: args.channel
  }
}

const options = parseArgs(process.argv.slice(2))
const require = createRequire(path.join(options.repo, 'package.json'))
const { chromium } = require('playwright-core')
const url =
  options.url ??
  JSON.parse(readFileSync(path.join(options.repo, '.cache/fixtures/server.json'), 'utf8')).url
const FIXTURE = 'dashboard/fleet/AgentDashboardScale'
const UPDATE_SIZE = 300
const SIDES = ['Fleet', 'Board']

function machine() {
  const sh = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
    } catch (error) {
      return `unavailable: ${error.message.split('\n')[0]}`
    }
  }
  return {
    at: new Date().toISOString(),
    uptime: sh('uptime', []),
    loadavg: os.loadavg(),
    cores: os.cpus().length,
    cpu: os.cpus()[0]?.model,
    memGiB: Math.round(os.totalmem() / 2 ** 30),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    node: process.version,
    repoHead: sh('git', ['-C', options.repo, 'rev-parse', 'HEAD']),
    repoBranch: sh('git', ['-C', options.repo, 'rev-parse', '--abbrev-ref', 'HEAD'])
  }
}

function stats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) {
    return null
  }
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))]
  const round = (value) => Math.round(value * 100) / 100
  return {
    n: sorted.length,
    median: round(at(0.5)),
    min: round(sorted[0]),
    max: round(sorted.at(-1)),
    p95: round(at(0.95))
  }
}

// Runs in the page. Renders one fixture and reports timing, DOM size and what was rendered.
async function renderInPage([id, theme]) {
  const root = document.documentElement
  const ready = new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const state = root.dataset.fixtureState
      if (state === 'ready' || state === 'error') {
        observer.disconnect()
        resolve({ state, at: performance.now() })
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-fixture-state'] })
  })
  const start = performance.now()
  await window.__orcaComponentFixtureHost.render(id, theme)
  const outcome = await ready
  const perf = window.__fleetPerf
  const commits = perf.commits.filter((commit) => commit.commitTime <= outcome.at)
  return {
    state: outcome.state,
    error: root.dataset.fixtureError ?? null,
    toReadyMs: outcome.at - start,
    toLastCommitMs: commits.length ? Math.max(...commits.map((c) => c.commitTime)) - start : null,
    profilerMs: commits.reduce((total, commit) => total + commit.actualDuration, 0),
    profilerCommits: commits.length,
    cardCount: perf.cardCount,
    view: perf.view,
    expectedFleetNodes: perf.expectedFleetNodes
  }
}

// Runs in the page. What the fixture root holds right now.
function domCountsInPage() {
  const frame = document.getElementById('component-fixture-frame')
  const titled = [...frame.querySelectorAll('button:not([data-slot])')].filter((button) =>
    /Scale agent \d+/.test(button.textContent ?? '')
  )
  const laneCounts = [...frame.querySelectorAll('section[aria-label] > header > span:last-child')]
  const total = frame.querySelector('h1')?.nextElementSibling?.textContent ?? ''
  return {
    elements: frame.querySelectorAll('*').length,
    cardButtons: titled.length,
    boardRows: frame.querySelectorAll('[data-pane-key]').length,
    boardLaneTotal: laneCounts.reduce((sum, node) => sum + Number(node.textContent), 0),
    fleetTeamHeaders: frame.querySelectorAll('h3 button[data-slot="collapsible-trigger"]').length,
    headerTotal: Number.parseInt(total, 10)
  }
}

async function collectTicksInPage([count]) {
  const perf = window.__fleetPerf
  await new Promise((resolve) => setTimeout(resolve, 500))
  perf.ticks.length = 0
  const started = performance.now()
  await new Promise((resolve, reject) => {
    const poll = () => {
      if (perf.ticks.length >= count) {
        resolve()
      } else if (performance.now() - started > count * 2000) {
        reject(new Error(`only ${perf.ticks.length} of ${count} ticks arrived`))
      } else {
        setTimeout(poll, 20)
      }
    }
    poll()
  })
  const ticks = perf.ticks.slice(0, count)
  const last = perf.ticks.at(-1)
  const title = new RegExp(`Scale agent ${last.flippedIndex}:`)
  const frame = document.getElementById('component-fixture-frame')
  const node = [...frame.querySelectorAll('button:not([data-slot])')].find((button) =>
    title.test(button.textContent ?? '')
  )
  const row = frame.querySelector(
    `[data-pane-key="scale-tab-${last.flippedIndex}:leaf-${last.flippedIndex}"]`
  )
  const lastFlip = {
    index: last.flippedIndex,
    toAttention: last.flippedToAttention,
    fleetNodeShowsAttention:
      perf.view === 'fleet' && node ? node.className.includes('border-agent-question') : null,
    boardLane: row?.closest('section[aria-label]')?.getAttribute('aria-label') ?? null
  }
  return { ticks, lastFlip }
}

function checkWork(sample) {
  const problems = []
  if (sample.state !== 'ready') {
    problems.push(`fixture state ${sample.state}: ${sample.error}`)
  }
  if (sample.dom.headerTotal !== sample.cardCount) {
    problems.push(`header total ${sample.dom.headerTotal} != ${sample.cardCount} cards`)
  }
  if (sample.view === 'fleet' && sample.dom.cardButtons !== sample.expectedNodes) {
    problems.push(`fleet nodes ${sample.dom.cardButtons} != expected ${sample.expectedNodes}`)
  }
  if (sample.view === 'board') {
    if (sample.dom.boardLaneTotal !== sample.cardCount) {
      problems.push(`lane counts ${sample.dom.boardLaneTotal} != ${sample.cardCount} cards`)
    }
    if (sample.dom.boardRows === 0 || sample.dom.boardRows > sample.cardCount) {
      problems.push(`board mounted ${sample.dom.boardRows} rows`)
    }
  }
  return problems
}

async function main() {
  mkdirSync(options.out, { recursive: true })
  const launch = options.browser
    ? { executablePath: options.browser }
    : options.channel
      ? { channel: options.channel }
      : {}
  const browser = await chromium.launch({ headless: true, ...launch })
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  ).newPage()
  const errors = []
  let current = 'setup'
  page.on('pageerror', (error) => errors.push({ during: current, kind: 'pageerror', text: error.message }))
  const ignored = []
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return
    }
    const entry = { during: current, kind: 'console', text: message.text(), url: message.location().url }
    // The fixture server serves no favicon; Chromium requests one on page load, outside any run.
    if (new URL(entry.url || 'about:blank', url).pathname === '/favicon.ico') {
      ignored.push(entry)
    } else {
      errors.push(entry)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname !== '/favicon.ico') {
      errors.push({ during: current, kind: 'http', text: `${response.status()} ${response.url()}` })
    }
  })
  await page.goto(`${url}/fixtures.html?worker=1`)
  await page.waitForFunction(() => Boolean(window.__orcaComponentFixtureHost), undefined, {
    timeout: 120_000
  })
  const meta = { ...machine(), url, browser: browser.version(), options }
  console.log(`machine: ${meta.uptime} | ${meta.cores} cores | ${meta.cpu} | browser ${meta.browser}`)

  const render = async (id) => {
    const sample = await page.evaluate(renderInPage, [id, options.theme])
    sample.dom = await page.evaluate(domCountsInPage)
    sample.expectedNodes = sample.expectedFleetNodes
    return sample
  }

  current = 'warmup'
  for (const size of options.sizes) {
    for (const side of SIDES) {
      await render(`${FIXTURE}:scale${size}${side}`)
    }
  }

  const mounts = []
  for (let run = 0; run < options.runs; run += 1) {
    const order = run % 2 === 0 ? SIDES : [...SIDES].reverse()
    for (const size of options.sizes) {
      for (const side of order) {
        const id = `${FIXTURE}:scale${size}${side}`
        current = `mount ${id} run ${run}`
        const errorsBefore = errors.length
        const sample = await render(id)
        sample.problems = checkWork(sample)
        sample.errors = errors.length - errorsBefore
        mounts.push({ run, size, side, id, ...sample })
        console.log(
          `mount run ${run} ${side} ${size}: ready ${sample.toReadyMs.toFixed(1)} ms, ` +
            `react ${sample.profilerMs.toFixed(1)} ms in ${sample.profilerCommits} commits, ` +
            `${sample.dom.elements} elements${sample.problems.length ? ` PROBLEMS ${sample.problems}` : ''}`
        )
      }
    }
  }

  const updates = []
  for (let run = 0; run < options.runs; run += 1) {
    const order = run % 2 === 0 ? SIDES : [...SIDES].reverse()
    for (const side of order) {
      const id = `${FIXTURE}:scale${UPDATE_SIZE}${side}Updates`
      current = `updates ${id} run ${run}`
      const errorsBefore = errors.length
      const mount = await render(id)
      const { ticks, lastFlip } = await page.evaluate(collectTicksInPage, [options.ticks])
      const dom = await page.evaluate(domCountsInPage)
      const lastExpected = ticks.at(-1)?.expectedFleetNodes
      const sample = { ...mount, dom, expectedNodes: lastExpected }
      const problems = checkWork(sample)
      if (side === 'Fleet' && lastFlip.fleetNodeShowsAttention !== lastFlip.toAttention) {
        problems.push(`last flipped card ${lastFlip.index} not rendered in its new state`)
      }
      if (
        side === 'Board' &&
        lastFlip.boardLane !== null &&
        (lastFlip.boardLane.toLowerCase() === 'needs you') !== lastFlip.toAttention
      ) {
        problems.push(`last flipped card ${lastFlip.index} sits in lane ${lastFlip.boardLane}`)
      }
      const commitless = ticks.filter((tick) => tick.commits === 0).length
      if (commitless > 0 && ticks.some((tick) => tick.profilerMs > 0)) {
        problems.push(`${commitless} ticks without a profiler commit`)
      }
      updates.push({
        run,
        side,
        id,
        ticks,
        dom,
        expectedNodes: lastExpected,
        lastFlip,
        problems,
        errors: errors.length - errorsBefore,
        perRun: {
          flushMs: stats(ticks.map((tick) => tick.flushMs)),
          profilerMs: stats(ticks.map((tick) => tick.profilerMs)),
          layoutMs: stats(ticks.map((tick) => tick.layoutMs))
        }
      })
      const s = updates.at(-1).perRun
      console.log(
        `updates run ${run} ${side}: flush median ${s.flushMs.median} ms (p95 ${s.flushMs.p95}), ` +
          `react median ${s.profilerMs?.median} ms, layout median ${s.layoutMs.median} ms, ` +
          `${dom.elements} elements${problems.length ? ` PROBLEMS ${problems}` : ''}`
      )
    }
  }
  current = 'teardown'
  await browser.close()

  const summary = { mount: {}, updates: {} }
  for (const size of options.sizes) {
    for (const side of SIDES) {
      const rows = mounts.filter((m) => m.size === size && m.side === side)
      summary.mount[`${side}${size}`] = {
        runs: rows.length,
        toReadyMs: stats(rows.map((r) => r.toReadyMs)),
        toLastCommitMs: stats(rows.map((r) => r.toLastCommitMs)),
        reactRenderMs: stats(rows.map((r) => r.profilerMs)),
        elements: stats(rows.map((r) => r.dom.elements)),
        cardButtons: stats(rows.map((r) => r.dom.cardButtons)),
        expectedFleetNodes: rows[0]?.expectedFleetNodes,
        problems: rows.flatMap((r) => r.problems),
        errors: rows.reduce((total, r) => total + r.errors, 0)
      }
    }
  }
  for (const side of SIDES) {
    const rows = updates.filter((u) => u.side === side)
    const all = rows.flatMap((r) => r.ticks)
    summary.updates[`${side}${UPDATE_SIZE}`] = {
      runs: rows.length,
      ticksPerRun: options.ticks,
      runMedianFlushMs: stats(rows.map((r) => r.perRun.flushMs.median)),
      runMedianReactMs: stats(rows.map((r) => r.perRun.profilerMs?.median)),
      runMedianLayoutMs: stats(rows.map((r) => r.perRun.layoutMs.median)),
      pooledFlushMs: stats(all.map((t) => t.flushMs)),
      pooledReactMs: stats(all.map((t) => t.profilerMs)),
      pooledLayoutMs: stats(all.map((t) => t.layoutMs)),
      profilerCommits: all.reduce((total, t) => total + t.commits, 0),
      elements: stats(rows.map((r) => r.dom.elements)),
      problems: rows.flatMap((r) => r.problems),
      errors: rows.reduce((total, r) => total + r.errors, 0)
    }
  }
  const results = { meta, summary, errors, ignoredErrors: ignored, mounts, updates }
  const file = path.join(options.out, 'results.json')
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
  console.log(`errors: ${errors.length} (ignored favicon 404s: ${ignored.length}); wrote ${file}`)
}

await main()
