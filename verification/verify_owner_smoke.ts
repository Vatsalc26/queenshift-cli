import { formatOwnerSmokeResult, runOwnerSmoke } from "../src/owner/OwnerSmoke"

async function main(): Promise<void> {
	const result = await runOwnerSmoke()
	console.log(formatOwnerSmokeResult(result))
	process.exit(result.passed ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:smoke] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
