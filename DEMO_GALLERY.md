# Queenshift Demo Gallery

This gallery stays tied to real supported lanes, real commands, and real artifacts. It does not claim broad autonomy outside the bounded proof lanes.

## Best First Run

### Disposable comment addition

- Lane: `small live demo pack`
- Task: `add a brief comment to hello.ts`
- Surface: `npm.cmd exec -- queenshift demo:run`
- Replay: `npm.cmd exec -- queenshift replay:latest --workspace "verification\\.demo_repo_workspace"`
- Diff: `git -C "verification\\.demo_repo_workspace" show --stat HEAD`
- Proof anchor: `npm.cmd run verify:demo:run`, `npm.cmd run verify:replay-export`
- Why it exists: stages a disposable repo copy, produces normal run artifacts, and now prints the replay overview plus replay command without pretending the demo is production-safe

## Guided Owner Examples

### One-file note creation

- Lane: `small guided preview`
- Task: `create notes.md with one sentence describing this repo`
- Surface: thin shell `Guided` starter library
- Proof anchor: `npm.cmd run verify:owner:task-library`, `npm.cmd run verify:task-composer`
- Why it exists: recommended first task for a noncoder because the final task text stays visible before launch

### Small rename with direct call sites

- Lane: `semi-open guided preview`
- Task: `rename the export in src/format.ts to formatValue and update its direct call sites`
- Surface: thin shell `Guided` starter library
- Replay after run: `node dist/swarm.js replay:latest --workspace <repo>`
- Proof anchor: `npm.cmd run verify:owner:task-library`, `npm.cmd run verify:lane:semiopen`
- Why it exists: demonstrates the anchored rename-export discovery lane without pretending broad repo discovery is supported

## Coordination Examples

### Bounded two-file coordination

- Lane: `scoped coordination`
- Task: `update hello.ts and utils.ts together`
- Surface: `node dist/swarm.js --task "update hello.ts and utils.ts together" --workspace "verification\\.demo_repo_workspace" --dryRun`
- Replay: `node dist/swarm.js replay:latest --workspace "verification\\.demo_repo_workspace"`
- Proof anchor: `npm.cmd run verify:progress-map`, `npm.cmd run verify:replay-export`
- Why it exists: shows plan, progress, replay overview, and outcome artifacts for a bounded coordinated task

### Explicit medium bounded lane

- Lane: `medium bounded`
- Task: `update hello.ts, utils.ts, package.json, notes.md, guide.md, and extra.ts together`
- Surface: `node dist/swarm.js --task "update hello.ts, utils.ts, package.json, notes.md, guide.md, and extra.ts together" --workspace "verification\\.demo_repo_workspace" --dryRun`
- Replay: `node dist/swarm.js replay:latest --workspace "verification\\.demo_repo_workspace"`
- Proof anchor: `npm.cmd run verify:lane:medium`, `npm.cmd run verify:replay-export`
- Why it exists: demonstrates the explicit 6-10 file lane with critic, retry, and checkpoint evidence still in bounds

## Notes

- `npm.cmd exec -- queenshift demo:gallery` prints the same gallery in the terminal.
- The replay command is read-only. It reports the artifact-backed overview plus timeline from `.swarm\\runs\\<taskId>\\replay.json`.
- The bundle and docs should always point at these same examples rather than inventing new marketing-only demos.
