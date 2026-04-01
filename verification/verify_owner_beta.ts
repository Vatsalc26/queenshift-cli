import { formatOwnerBetaResult, runOwnerBeta } from "../src/owner/OwnerBeta"

async function main(): Promise<void> {
	const result = await runOwnerBeta()
	console.log(formatOwnerBetaResult(result))
	process.exit(result.ready ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:beta] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
