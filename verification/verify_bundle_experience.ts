import { formatProofBundleResult, proofBundlePassed, runBundleExperienceBundle } from "./ProofBundles"

async function main(): Promise<void> {
	const result = await runBundleExperienceBundle()
	console.log(formatProofBundleResult(result))
	process.exit(proofBundlePassed(result) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:bundle:experience] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
