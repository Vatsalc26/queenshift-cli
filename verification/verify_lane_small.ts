import { formatProofBundleResult, proofBundlePassed, runSmallLaneBundle } from "./ProofBundles"

async function main(): Promise<void> {
	const result = await runSmallLaneBundle()
	console.log(formatProofBundleResult(result))
	process.exit(proofBundlePassed(result) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:lane:small] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
