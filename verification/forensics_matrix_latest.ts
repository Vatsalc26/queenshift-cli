import fs from "node:fs"
import path from "node:path"

import {
	findLatestMatrixSummary,
	type MatrixRowResult,
	type MatrixRunSummary,
} from "./verify_live_matrix"

export function classifyMatrixFailureBucket(result: MatrixRowResult): { bucket: string; nextArtifact: string } {
	if (result.stopReason === "scope_drift" || result.stopReason === "missing_expected_change" || result.stopReason === "too_many_changed_files") {
		return { bucket: "scope drift", nextArtifact: result.summaryPath ?? result.workspace }
	}
	if (result.stopReason === "review_blocked" || result.stopReason === "reviewer_invalid" || result.stopReason === "reviewer_unavailable") {
		return { bucket: "review blocked", nextArtifact: result.summaryPath ?? result.workspace }
	}
	if (result.stopReason === "dirty_repo_refusal" || result.stopReason === "matrix_reset_failed") {
		return { bucket: "dirty repo refusal", nextArtifact: result.workspace }
	}
	if (result.stopReason === "timeout" || result.stopReason === "watchdog_abort") {
		return { bucket: "timeout or watchdog", nextArtifact: result.summaryPath ?? result.workspace }
	}
	if (result.stopReason === "merge_conflict") {
		return { bucket: "merge conflict", nextArtifact: result.summaryPath ?? result.workspace }
	}
	if (result.stopReason === "no_diff_evidence") {
		return { bucket: "no diff evidence", nextArtifact: result.summaryPath ?? result.workspace }
	}
	if (result.stopReason.startsWith("provider_") || result.stopReason === "command_blocked") {
		return { bucket: "provider or config failure", nextArtifact: result.summaryPath ?? result.workspace }
	}
	return { bucket: "unknown", nextArtifact: result.summaryPath ?? result.workspace }
}

export function groupMatrixFailures(results: MatrixRowResult[]): Array<{ bucket: string; taskIds: string[]; nextArtifact: string }> {
	const grouped = new Map<string, { taskIds: string[]; nextArtifact: string }>()
	for (const result of results.filter((entry) => !entry.passed)) {
		const bucket = classifyMatrixFailureBucket(result)
		const existing = grouped.get(bucket.bucket)
		if (existing) {
			existing.taskIds.push(result.id)
			continue
		}
		grouped.set(bucket.bucket, { taskIds: [result.id], nextArtifact: bucket.nextArtifact })
	}

	return Array.from(grouped.entries()).map(([bucket, value]) => ({
		bucket,
		taskIds: value.taskIds,
		nextArtifact: value.nextArtifact,
	}))
}

export function formatMatrixForensicsReport(summaryPath: string | null, summary: MatrixRunSummary | null): string {
	if (!summaryPath || !summary) {
		return "No matrix summary found yet. Run npm run verify:live:matrix first."
	}

	const groups = groupMatrixFailures(summary.results)
	if (groups.length === 0) {
		return [
			`Latest matrix summary: ${summaryPath}`,
			`Total rows: ${summary.totalRows}`,
			"Failure buckets: none",
		].join("\n")
	}

	return [
		`Latest matrix summary: ${summaryPath}`,
		`Total rows: ${summary.totalRows}`,
		...groups.map((group) => `${group.bucket}: ${group.taskIds.join(", ")} | inspect ${group.nextArtifact}`),
	].join("\n")
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function main(): Promise<void> {
	const rootDir = resolveRootDir()
	const summaryPath = findLatestMatrixSummary(rootDir)
	const summary =
		summaryPath && fs.existsSync(summaryPath)
			? (JSON.parse(fs.readFileSync(summaryPath, "utf8")) as MatrixRunSummary)
			: null
	console.log(formatMatrixForensicsReport(summaryPath, summary))
	process.exit(summaryPath ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[forensics:matrix:latest] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
