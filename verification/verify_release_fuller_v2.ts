import { formatProofBundleResult, proofBundlePassed, runFullerSwarmReleaseBundle } from "./ProofBundles"

async function main(): Promise<void> {
	const result = await runFullerSwarmReleaseBundle()
	console.log(formatProofBundleResult(result))
	process.exit(proofBundlePassed(result) ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:release:fuller-v2] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
