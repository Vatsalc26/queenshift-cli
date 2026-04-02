# Repo Support Tiers

This file defines the current repo readiness tiers surfaced by admission and onboarding.

## Tier Labels

1. `Small supported repo`
   Use this for the smallest clean repos well inside the bounded file and size envelope.
2. `Medium supported repo`
   Use this for larger but still admitted repos that remain inside the current bounded limits.
3. `Large repo tier 2 candidate`
   The repo is admitted with review bias because it exceeds the tier-1 envelope but stays inside the bounded tier-2 file-count and size limits.
4. `Large repo refused`
   The repo is real, but it exceeds the current admitted tier-2 file-count or size envelope.
5. `Binary/generated-heavy repo refused`
   Too much of the repo is binary or generated output for the current bounded lane.
6. `Repo not ready`
   The repo is not a supported git workspace yet or cannot safely hold Swarm artifacts.

## Where Tiers Appear

1. `repo:onboard`
2. `--admitOnly`
3. `formatAdmissionReport(...)`
4. repo-readiness details in admission artifacts

## Related Commands

```powershell
npm.cmd run verify:admission
npm.cmd run verify:repo-map
node dist/swarm.js repo:onboard --workspace <repo>
node dist/swarm.js --task "add a brief comment to hello.ts" --admitOnly --workspace <repo>
```

Large-repo beta notes remain a later-stage public surface until that larger-repo package is ready for a clearer release story.

## Large-Repo Beta Status

1. `verify:live:beta` is an evidence ladder for broader repo confidence, not a blanket public promise for large repos.
2. Repo tiers and repo-map output now distinguish between the normal bounded lane and the admitted tier-2 large-repo candidate lane.
3. A repo marked `Large repo tier 2 candidate` is still more review-heavy than the smaller tiers.
4. A repo marked `Large repo refused` stays out of bounds even if some other beta row passed on a different staged repo.
5. The current large-repo beta matrix stages `7` repo copies across `12` explicit rows and now groups beta success by support tier.

## Boundaries

1. Tier labels describe readiness first, not a promise that every task is supported.
2. Tier-2 large repos are allowed with review bias, not normalized into the small/medium lane.
3. Refused large repos stay refused until the product boundary grows with proof.
4. Repo tiers do not override task admission or verification-profile safety.
