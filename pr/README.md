# Materials for the Agent Dashboard Fleet view PR (stablyai/orca #44075)

Nothing here is part of the PR's files. This branch only hosts screenshots and evidence for the PR description.

| Folder | Contents |
|---|---|
| `images/` | Before and after screenshots (real app and component fixtures), feature close-ups, light and dark, narrow width, pop-out, performance charts |
| `perf/` | `REPORT.md` (verdict, numbers, limiter, checklist), raw results from the A/B/A run, the harness (`run.mjs`, `summarize.py`, `server-aba.sh`, `profile-fn.mjs`) and its instructions (`HARNESS.txt`) |
| `verification/` | The Playwright spec that drives the real app in a hidden window (`fleet-verify.spec.ts`), its runner (`run.sh`) and what it asserts (`README.txt`) |

Screenshots of the real app come from a background-launched dev build (`ORCA_BACKGROUND_LAUNCH=1`) with three shell panes linked by real `orca orchestration dispatch` calls (A → B → C) and fake Claude hook states. Fixture screenshots use the seeded mock in `src/renderer/src/components/dashboard/fleet/`.
