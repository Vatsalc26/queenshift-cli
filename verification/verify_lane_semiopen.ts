import { formatProofBundleResult, proofBundlePassed, runSemiOpenLaneBundle } from "./ProofBundles"

async function main(): Promise<void> {
	const result = await runSemiOpenLaneBundle()
	console.log(formatProofBundleResult(result))
	process.exit(proofBundlePassed(result) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:lane:semiopen] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
