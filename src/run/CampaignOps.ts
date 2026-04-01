import fs from "node:fs"
import path from "node:path"

import type { CampaignContinuationState } from "../planning/CampaignContinuation"
import { listRunDirs, readRunSummary, resolveRunSummaryPath } from "./RunArtifacts"
import { readWorkQueueArtifact, type WorkQueueItem } from "./WorkQueue"

export type CampaignRunEntry = {
	runId: string
	task: string | null
	status: string | null
	stopReason: string | null
	attemptNumber: number | null
	summaryPath: string
}

export type CampaignSummary = {
	campaignId: string
	originRunId: string
	currentRunId: string
	previousRunId: string | null
	attemptNumber: number
	nextAttemptNumber: number
	sourceRunIds: string[]
	runCount: number
	queuedCount: number
	nextQueuedTask: string | null
	latestStatus: string | null
	latestStopReason: string | null
	runEntries: CampaignRunEntry[]
	queueItems: WorkQueueItem[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

function asCampaignState(value: unknown): CampaignContinuationState | null {
	const record = asRecord(value)
	if (!record) return null
	const campaignId = asString(record["campaignId"])
	const originRunId = asString(record["originRunId"])
	const currentRunId = asString(record["currentRunId"])
	if (!campaignId || !originRunId || !currentRunId) return null
	return {
		schemaVersion: 1,
		campaignId,
		originRunId,
		currentRunId,
		previousRunId: asString(record["previousRunId"]),
		attemptNumber: Math.max(1, asNumber(record["attemptNumber"]) ?? 1),
		nextAttemptNumber: Math.max(2, asNumber(record["nextAttemptNumber"]) ?? 2),
		sourceRunIds: asStringArray(record["sourceRunIds"]),
	}
}

function extractCampaignState(summary: Record<string, unknown> | null): CampaignContinuationState | null {
	if (!summary) return null
	return (
		asCampaignState(summary["campaign"]) ??
		asCampaignState(asRecord(summary["checkpoints"])?.["continuation"]) ??
		asCampaignState(asRecord(summary["retryPlanner"])?.["continuation"])
	)
}

function summaryRunId(runDir: string, summary: Record<string, unknown> | null): string {
	return asString(summary?.["taskId"]) ?? path.basename(runDir)
}

function entryAttempt(entry: CampaignRunEntry): number {
	return entry.attemptNumber ?? Number.MAX_SAFE_INTEGER
}

function queueSortKey(left: WorkQueueItem, right: WorkQueueItem): number {
	const leftTime = left.scheduledAt ?? left.createdAt
	const rightTime = right.scheduledAt ?? right.createdAt
	return leftTime.localeCompare(rightTime) || left.createdAt.localeCompare(right.createdAt) || left.queueId.localeCompare(right.queueId)
}

export function resolveCampaignSummary(workspace: string, preferredRunId?: string | null): CampaignSummary | null {
	const preferredSummaryPath =
		preferredRunId && preferredRunId.trim()
			? resolveRunSummaryPath(path.join(workspace, ".swarm", "runs", preferredRunId.trim()))
			: null
	const preferredSummary =
		preferredSummaryPath && fs.existsSync(preferredSummaryPath)
			? (readRunSummary(path.dirname(preferredSummaryPath)) as Record<string, unknown> | null)
			: null
	const currentState = extractCampaignState(preferredSummary)
	if (!currentState) return null

	const runEntries = listRunDirs(workspace)
		.map((runDir) => {
			const summaryPath = resolveRunSummaryPath(runDir)
			const summary = readRunSummary(runDir)
			if (!summary || !fs.existsSync(summaryPath)) return null
			const state = extractCampaignState(summary)
			if (!state || state.campaignId !== currentState.campaignId) return null
			return {
				runId: summaryRunId(runDir, summary),
				task: asString(summary["task"]),
				status: asString(summary["status"]),
				stopReason: asString(summary["stopReason"]),
				attemptNumber: asNumber(state.attemptNumber),
				summaryPath,
			} satisfies CampaignRunEntry
		})
		.filter((entry): entry is CampaignRunEntry => entry !== null)
		.sort((left, right) => entryAttempt(left) - entryAttempt(right) || left.runId.localeCompare(right.runId))

	const queueItems = readWorkQueueArtifact(workspace).items
		.filter((item) => item.status === "queued" && item.campaignId === currentState.campaignId)
		.sort(queueSortKey)

	const latestEntry = runEntries.at(-1) ?? null

	return {
		campaignId: currentState.campaignId,
		originRunId: currentState.originRunId,
		currentRunId: currentState.currentRunId,
		previousRunId: currentState.previousRunId,
		attemptNumber: currentState.attemptNumber,
		nextAttemptNumber: currentState.nextAttemptNumber,
		sourceRunIds: currentState.sourceRunIds.length > 0 ? [...currentState.sourceRunIds] : runEntries.map((entry) => entry.runId),
		runCount: runEntries.length,
		queuedCount: queueItems.length,
		nextQueuedTask: queueItems[0]?.task ?? null,
		latestStatus: latestEntry?.status ?? null,
		latestStopReason: latestEntry?.stopReason ?? null,
		runEntries,
		queueItems,
	}
}

export function formatCampaignSummary(summary: CampaignSummary | null): string {
	if (!summary) return "Campaign: (none)"
	return [
		`Campaign: ${summary.campaignId}`,
		`Origin: ${summary.originRunId}`,
		`Current run: ${summary.currentRunId}`,
		`Attempt: ${summary.attemptNumber} -> next ${summary.nextAttemptNumber}`,
		`Runs in campaign: ${summary.runCount}`,
		`Queued follow-ups: ${summary.queuedCount}`,
		`Next queued task: ${summary.nextQueuedTask ?? "(none)"}`,
		`Latest status: ${summary.latestStatus ?? "(unknown)"}${summary.latestStopReason ? ` (${summary.latestStopReason})` : ""}`,
	].join("\n")
}
