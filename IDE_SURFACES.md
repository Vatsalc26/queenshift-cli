# IDE Surfaces

This file defines the supported IDE wrapper surfaces and the guardrails that keep them wrapper-only.

## Supported Wrapper Surfaces

1. VS Code Extension Development Host from source checkout.
2. The packaged Windows RC1 thin-shell launcher opened by `scripts\rc1_open_thin_shell.ps1`.

## Shared Contract

Every supported IDE surface must do these same things:

1. show the exact `queenshift` command preview before launch
2. launch the compiled Queenshift CLI entry, which is `dist/swarm.js` in this repo
3. pass the selected `--workspace`
4. show the same CLI runtime summary, summary artifact, and forensics truth the product already derives from local artifacts
5. read `summary.json`, review packs, incident packs, and replay artifacts instead of inventing a second state store
6. keep review and discard actions as CLI-backed commands

## What Is Not Supported

1. a marketplace extension release
2. an IDE-owned orchestrator or hidden approval plane
3. a second truth source outside the local artifact chain
4. unsupported editor plugins that bypass the CLI contract

## Proof Sources

1. `npm.cmd run verify:vscode:shell`
2. `npm.cmd run verify:owner:surface`
3. `npm.cmd run verify:queenbee:progress-live`
4. `SUPPORTED_INSTALL_SURFACES.md`
