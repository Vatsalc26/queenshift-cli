# Knowledge Pack Setup

This file explains the checked-in knowledge-pack surface used by repo onboarding, repo-map discovery packs, and context packs.

## What It Is

The knowledge pack is one repo-root file:

`\.swarmcoder.knowledge-pack.json`

It lets a repo point Queenshift at the stable docs contributors actually want in planning and review.

## Scaffold Path

Use repo onboarding to create it:

```powershell
npm.cmd run repo:onboard -- --workspace <repo> --scaffoldKnowledgePack
```

The scaffold is bounded:

1. it writes one JSON file at `.swarmcoder.knowledge-pack.json`
2. it suggests stable guides such as `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE_DECISIONS.md`, `LANGUAGE_PACKS.md`, and `OWNER_OVERSIGHT_GUIDE.md`
3. it does not create hidden memory or embeddings

## File Shape

```json
{
  "schemaVersion": 1,
  "docs": [
    "README.md",
    "CONTRIBUTING.md"
  ],
  "notes": [
    "Keep this pack checked in and bounded to the docs contributors actually use during planning and review."
  ]
}
```

## How It Is Used

1. `repo:onboard` reports whether the knowledge pack is missing, present, or invalid.
2. The repo map derives one bounded `progressive_bounded` discovery pack from knowledge-pack docs first, then repo entry/config hints, then verification lanes.
3. Context packs prefer `docs` from the knowledge pack before falling back to repo-map key docs.
4. `notes` stay visible as repo-owned reminders, not hidden agent memory.
5. `memory:show --workspace <repo>` surfaces the knowledge-pack layer explicitly inside the workspace-memory precedence stack.

## Proof Sources

1. `npm.cmd run verify:owner:onboarding`
2. `npm.cmd run verify:context-packs`
3. `npm.cmd run verify:repo-map`
4. `npm.cmd run verify:pattern-memory`

## Boundaries

1. The knowledge pack is checked-in repo configuration, not a hidden cache.
2. It prioritizes docs; it does not widen file-edit scope by itself.
3. Invalid JSON or the wrong `schemaVersion` is surfaced explicitly during onboarding.
4. The derived discovery pack stays read-only, bounded, and inspectable; it does not create hidden memory or silent repo crawling.
5. Current task contract and current-run artifacts still outrank the knowledge pack when truth conflicts.
