import fs from "node:fs"

import { classifyStopReason } from "../run/Forensics"
import { listRunDirs, readRunSummary, resolveRunSummaryPath } from "../run/RunArtifacts"

export type OwnerOutcomeBucket = {
	bucket: string
	count: number
}

export type OwnerOutcomeSnapshot = {
	windowRuns: number
	doneRuns: number
	reviewRequiredRuns: number
	failedRuns: number
	successRate: number | null
	failureBuckets: OwnerOutcomeBucket[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function formatRate(rate: number | null): string {
	if (rate === null) return "n/a"
	return `${Math.round(rate * 1000) / 10}%`
}

export function buildOwnerOutcomeSnapshot(workspace: string, maxRuns = 20): OwnerOutcomeSnapshot {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace || !fs.existsSync(normalizedWorkspace)) {
		return {
			windowRuns: 0,
			doneRuns: 0,
			reviewRequiredRuns: 0,
			failedRuns: 0,
			successRate: null,
			failureBuckets: [],
		}
	}

	const runs = listRunDirs(normalizedWorkspace)
		.map((runDir) => {
			const summary = asRecord(readRunSummary(runDir))
			const status = asString(summary?.["status"])
			if (status !== "done" && status !== "review_required" && status !== "failed") return null
			return {
				status,
				stopReason: asString(summary?.["stopReason"]),
				mtimeMs: fs.existsSync(resolveRunSummaryPath(runDir)) ? fs.statSync(resolveRunSummaryPath(runDir)).mtimeMs : 0,
			}
		})
		.filter((entry): entry is { status: "done" | "review_required" | "failed"; stopReason: string | null; mtimeMs: number } => entry !== null)
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
		.slice(0, Math.max(1, maxRuns))

	let doneRuns = 0
	let reviewRequiredRuns = 0
	let failedRuns = 0
	const failureBuckets = new Map<string, number>()

	for (const run of runs) {
		if (run.status === "done") {
			doneRuns += 1
			continue
		}
		if (run.status === "review_required") reviewRequiredRuns += 1
		if (run.status === "failed") failedRuns += 1
		const bucket = run.stopReason ? classifyStopReason(run.stopReason).bucket : run.status.replace(/_/g, " ")
		failureBuckets.set(bucket, (failureBuckets.get(bucket) ?? 0) + 1)
	}

	return {
		windowRuns: runs.length,
		doneRuns,
		reviewRequiredRuns,
		failedRuns,
		successRate: runs.length > 0 ? doneRuns / runs.length : null,
		failureBuckets: Array.from(failureBuckets.entries())
			.map(([bucket, count]) => ({ bucket, count }))
			.sort((left, right) => right.count - left.count || left.bucket.localeCompare(right.bucket)),
	}
}

export function formatOwnerOutcomeDashboard(snapshot: OwnerOutcomeSnapshot): string {
	if (snapshot.windowRuns === 0) {
		return "Outcome dashboard: no terminal local runs recorded yet."
	}
	return [
		`Outcome dashboard: runs=${snapshot.windowRuns} done=${snapshot.doneRuns} review_required=${snapshot.reviewRequiredRuns} failed=${snapshot.failedRuns} success=${formatRate(snapshot.successRate)}`,
		`Outcome buckets: ${snapshot.failureBuckets.map((bucket) => `${bucket.bucket}=${bucket.count}`).join(" | ") || "(none)"}`,
	].join("\n")
}

export function formatOwnerOutcomeDashboardInline(snapshot: OwnerOutcomeSnapshot): string {
	if (snapshot.windowRuns === 0) return "Outcome dashboard: no terminal local runs yet."
	return [
		`Outcome dashboard: runs=${snapshot.windowRuns} done=${snapshot.doneRuns} review_required=${snapshot.reviewRequiredRuns} failed=${snapshot.failedRuns} success=${formatRate(snapshot.successRate)}`,
		`Outcome buckets: ${snapshot.failureBuckets.map((bucket) => `${bucket.bucket}=${bucket.count}`).join(" | ") || "(none)"}`,
	].join("\n")
}

