# Queenshift Branding Assets

This folder holds the public branding assets for `Queenshift`.

Current asset layout:

1. `Queenshift.png`
2. `asset_manifest.json`
3. `exports/`

`Queenshift.png` is the current public source sheet. It contains the icon treatments, wordmark layouts, banner concepts, and app-tile candidates from which later cleaned export files can be cut.

Use this folder for:

1. public-repo avatar and social-preview candidates
2. README and release-page logo sources
3. later cleaned light/dark export variants

Current launch surface map:

1. GitHub avatar -> `exports/queenshift-icon-light.png`
2. README/release wordmark -> `exports/queenshift-wordmark-dark.png`
3. social preview or announcement banner -> `exports/queenshift-banner-dark.png`

Use `asset_manifest.json` as the canonical naming and placement map. Put future cleaned public-ready renders under `exports/` instead of inventing new ad hoc locations.

Current public-ready exports that now exist:

1. `exports/queenshift-icon-light.png`
2. `exports/queenshift-wordmark-dark.png`
3. `exports/queenshift-banner-dark.png`

Do not treat this folder as a shipped install/runtime surface.
