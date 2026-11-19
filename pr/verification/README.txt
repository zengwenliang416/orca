Fleet view E2E verification (hidden Electron, Playwright CDP)

Rerun against the worktree (reuses the current out/ build):
  /tmp/fleet-e2e/run.sh <orca-checkout>

Rerun after product changes (rebuilds the e2e app and CLI first):
  /tmp/fleet-e2e/run.sh <orca-checkout> --build

run.sh copies spec/fleet-verify.spec.ts into tests/e2e/zz-fleet-verify/ (it imports repo
fixtures by relative path), runs it with ORCA_BACKGROUND_LAUNCH=1 on the electron-headless
project, deletes the copy, and prints `git status --short` (expect empty).
It also unsets ORCA_* / CLAUDE_CODE_SESSION* from the caller's env: run from inside an Orca
agent session, the built CLI otherwise inherits ORCA_AGENT_SESSION_ID and refuses --from
with consumer_fenced.

One-time prerequisite, already done in this worktree (node_modules/electron had no binary):
  cd <orca-checkout>
  ELECTRON_GET_USE_PROXY=1 GLOBAL_AGENT_HTTPS_PROXY="$HTTPS_PROXY" pnpm run ensure:electron-runtime

Outputs:
  /tmp/fleet-e2e/rerun.log   full log; grep '^\[fleet-e2e\]' for CLI results, store lineage,
                             DOM tree, summary tiles, dialog identity, window visibility
  /tmp/fleet-e2e/fleet-dom.json
  /tmp/fleet-e2e/01..09-*.png

What the spec drives: 3 shell panes A/B/C; real CLI lineage (A run-create, task-create,
dispatch -> B; B run-create (nested Run, a worker may not coordinate its own Run),
task-create, dispatch -> C); Claude hooks A working, B PermissionRequest, C Stop; UI pinned to
uiLanguage 'en'; in-window drawer Board -> Fleet -> node click -> keyboard -> Board; then the
pop-out via window.api.dashboard.openPopout().

DOM assumptions a Fleet layout change (e.g. project headers) may break, all in the spec:
- fleetTree(): a team is a <section> whose direct child is an <h3> (its collapse trigger); node buttons exclude the one inside that <h3>; depth is the
  count of nested <li> around each node <button> (wide "tree" layout only; the narrow
  "outline" layout has no <li>). A project-header wrapper that is itself a
  <section> with a direct <header><h3> would be counted as a team.
- expect(tree).toHaveLength(1): exactly one team section in the view.
- Check 4b: the project header is the button inside a <section> whose direct child is <h2>; reopening the drawer must keep Fleet selected and the project collapsed (localStorage in the main window).
- summaryBand(): tiles are span.text-lg.tabular-nums with an .uppercase label sibling.
- previewDialog(): the terminal preview is the role=dialog whose heading is not "Agents"
  (the in-window drawer is itself a dialog titled "Agents").
