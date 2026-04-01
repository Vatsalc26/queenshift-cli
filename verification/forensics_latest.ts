import fs from "node:fs"
import path from "node:path"

import { findLatestRunSummary } from "../src/run/RunArtifacts"
import { formatForensicsReport, type SummaryLike } from "../src/run/Forensics"

export { classifyStopReason, formatForensicsReport } from "../src/run/Forensics"

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
	return path.join(candidate, "..")
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const workspace = path.join(rootDir, "verification", "test_workspace")
	const summaryPath = findLatestRunSummary(workspace)
	const summary =
		summaryPath && fs.existsSync(summaryPath) ? (JSON.parse(fs.readFileSync(summaryPath, "utf8")) as SummaryLike) : null

	console.log(formatForensicsReport(summaryPath, summary))
	process.exit(summaryPath ? 0 : 1)
}

if (require.main === module) {
	main().catch((err) => {
		console.error(`[forensics:latest] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
