import { formatProofBundleResult, proofBundlePassed, runSmallReplayBundle } from "./ProofBundles"

async function main(): Promise<void> {
	const result = await runSmallReplayBundle()
	console.log(formatProofBundleResult(result))
	process.exit(proofBundlePassed(result) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:lane:small:replay] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
