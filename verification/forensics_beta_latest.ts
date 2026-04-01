import fs from "node:fs"
import path from "node:path"

import { findLatestBetaSummary, type BetaRunSummary } from "./verify_live_beta"

export { classifyBetaFailureBucket, groupBetaFailures } from "./verify_live_beta"

export function formatBetaForensicsReport(summaryPath: string | null, summary: BetaRunSummary | null): string {
	if (!summaryPath || !summary) {
		return "No beta summary found yet. Run npm run verify:live:beta first."
	}

	const lines = [
		`Latest beta summary: ${summaryPath}`,
		`Total rows: ${summary.totalRows}`,
		`Pass count: ${summary.passCount}`,
		`Review-required count: ${summary.reviewRequiredCount}`,
		`Failed count: ${summary.failedCount}`,
		`Refused count: ${summary.refusedCount}`,
	]

	const successByCorpus = summary.successByCorpus ?? []
	if (successByCorpus.length === 0) {
		lines.push("Task corpus success: none")
	} else {
		lines.push("Task corpus success:")
		for (const corpus of successByCorpus) {
			lines.push(`- ${corpus.corpusTaskId}: ${corpus.passCount}/${corpus.observed} (${corpus.passRate}%)`)
		}
	}

	const successBySupportTier = summary.successBySupportTier ?? []
	if (successBySupportTier.length === 0) {
		lines.push("Support tier success: none")
	} else {
		lines.push("Support tier success:")
		for (const supportTier of successBySupportTier) {
			lines.push(`- ${supportTier.label}: ${supportTier.passCount}/${supportTier.observed} (${supportTier.passRate}%)`)
		}
	}

	if (summary.topFailureBuckets.length === 0) {
		lines.push("Failure buckets: none")
		return lines.join("\n")
	}

	lines.push("Failure buckets:")
	for (const bucket of summary.topFailureBuckets) {
		lines.push(`- ${bucket.bucket}: ${bucket.rowIds.join(", ")} | inspect ${bucket.nextArtifact}`)
	}
	return lines.join("\n")
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const summaryPath = findLatestBetaSummary(rootDir)
	const summary =
		summaryPath && fs.existsSync(summaryPath) ? (JSON.parse(fs.readFileSync(summaryPath, "utf8")) as BetaRunSummary) : null

	console.log(formatBetaForensicsReport(summaryPath, summary))
	process.exit(summaryPath ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[forensics:beta:latest] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
