import fs from "node:fs"
import path from "node:path"

import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { buildRuntimeVisibilitySnapshot, formatQueenshiftRecoveryLoop } from "../cli/RuntimeVisibility"
import { buildFixRedLaneSuggestion as buildGeneratedFixRedLaneSuggestion, classifyFailureTaxonomy } from "../run/FailureTaxonomy"
import { classifyStopReason } from "../run/Forensics"
import { buildIncidentTriage, formatIncidentTriage, type IncidentTriage } from "../run/IncidentTriage"
import { resolveCampaignSummary } from "../run/CampaignOps"
import {
	listRunDirs,
	readIncidentPack,
	readReviewPack,
	readRunEvents,
	readRunSummary,
	resolveIncidentPackPath,
	resolveReviewPackPath,
	resolveRunSummaryPath,
	type RunEvent,
} from "../run/RunArtifacts"
import type { IncidentPack } from "../run/IncidentPack"
import type { ReviewPack } from "../run/ReviewQueue"
import { buildWorkQueueSummary } from "../run/WorkQueue"
import { formatLowSteeringOwnerLoop } from "./LowSteeringOwnerPath"
import { buildOwnerOutcomeSnapshot, formatOwnerOutcomeDashboard, formatOwnerOutcomeDashboardInline } from "./OutcomeDashboard"

type SummaryLike = Record<string, unknown>

export type OwnerQuickAction = {
	id: string
	label: string
	rationale: string
	command: string | null
	recommended: boolean
	source: "review" | "incident" | "summary" | "lifecycle"
}

export type OwnerQuickActionSet = {
	workspace: string
	runId: string | null
	summaryPath: string | null
	reviewPackPath: string | null
	incidentPackPath: string | null
	triage: IncidentTriage | null
	recommendedAction: OwnerQuickAction | null
	redLaneRecommended: boolean
	actions: OwnerQuickAction[]
}

export type OwnerLifeSignal = {
	workspace: string
	runId: string | null
	runState: "idle" | "running" | "done" | "review_required" | "failed" | "unknown"
	liveness: "not_started" | "alive" | "quiet" | "finished" | "unknown"
	lastEventAt: string | null
	lastEventType: string | null
	activeAgents: string[]
	activeWorkItems: string[]
	blockerBucket: string | null
	campaignId: string | null
	campaignAttemptNumber: number | null
	campaignRunCount: number
	campaignQueuedCount: number
	campaignNextQueuedTask: string | null
	queuePendingCount: number
	queueReadyCount: number
	queueAwaitingApprovalCount: number
	queueScheduledCount: number
	queueState: "empty" | "ready" | "awaiting_owner" | "scheduled"
	queueSummary: string
	queueNextCommand: string | null
	nextQueuedTask: string | null
	nextQueuedApprovalTask: string | null
	outcomeWindowRuns: number
	outcomeDoneRuns: number
	outcomeReviewRequiredRuns: number
	outcomeFailedRuns: number
	outcomeSuccessRate: number | null
	outcomeFailureBuckets: string[]
	nextSuggestedAction: string
	nextSuggestedCommand: string | null
	nextSuggestedRationale: string
	summaryPath: string | null
	runtimeVisibilityHeadline: string
	runtimeVisibilitySummary: string
	recoveryLoop: string | null
}

type OwnerRunContext = {
	runDir: string | null
	runId: string | null
	summaryPath: string | null
	summary: SummaryLike | null
	reviewPackPath: string | null
	reviewPack: ReviewPack | null
	incidentPackPath: string | null
	incidentPack: IncidentPack | null
	events: RunEvent[]
	lastUpdateMs: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

function buildWorkspaceSubcommand(command: string, workspace: string, runId?: string | null): string {
	const args = [command]
	if (runId && runId.trim()) args.push(runId.trim())
	return formatQueenshiftWorkspaceCommand(args, workspace)
}

function buildWorkspaceTaskCommand(task: string, workspace: string): string {
	return formatQueenshiftWorkspaceCommand([task], workspace)
}

function buildWorkspaceQueueApproveCommand(queueId: string, workspace: string): string {
	return formatQueenshiftWorkspaceCommand(["queue:approve", queueId], workspace)
}

function buildFixRedLaneSuggestion(context: OwnerRunContext, triage: IncidentTriage | null): string {
	const stopReason = asString(context.summary?.["stopReason"])
	const status = asString(context.summary?.["status"])
	const failureBucket = context.incidentPack?.failureBucket ?? null
	const taxonomy = classifyFailureTaxonomy({
		status,
		stopReason,
		failureBucket,
		hasReviewPack: Boolean(context.reviewPack),
	})
	const suggestion = buildGeneratedFixRedLaneSuggestion({
		runId: context.runId,
		taxonomy,
		summaryPath: context.summaryPath,
		incidentPackPath: context.incidentPackPath,
		reviewPackPath: context.reviewPackPath,
		stopReason,
		failureBucket,
		rationale: triage?.rationale ?? context.incidentPack?.redLaneHint.rationale ?? context.reviewPack?.nextAction.rationale ?? null,
		nextActionLabel: triage?.recommendedLabel ?? context.incidentPack?.nextAction.label ?? context.reviewPack?.nextAction.label ?? null,
	})
	return suggestion.stageCommand
}

function readFileMtime(filePath: string): number {
	try {
		return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0
	} catch {
		return 0
	}
}

function pickPreferredRunDir(workspace: string, preferredRunId?: string | null): string | null {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace || !fs.existsSync(normalizedWorkspace)) return null

	const preferred = preferredRunId?.trim()
	if (preferred) {
		const direct = path.join(normalizedWorkspace, ".swarm", "runs", preferred)
		if (fs.existsSync(direct)) return direct
	}

	const candidates = listRunDirs(normalizedWorkspace)
		.map((runDir) => {
			const summaryPath = resolveRunSummaryPath(runDir)
			const eventPath = path.join(runDir, "events.ndjson")
			const reviewPackPath = resolveReviewPackPath(runDir)
			const incidentPackPath = resolveIncidentPackPath(runDir)
			return {
				runDir,
				lastUpdateMs: Math.max(
					readFileMtime(summaryPath),
					readFileMtime(eventPath),
					readFileMtime(reviewPackPath),
					readFileMtime(incidentPackPath),
				),
			}
		})
		.filter((candidate) => candidate.lastUpdateMs > 0)
		.sort((left, right) => right.lastUpdateMs - left.lastUpdateMs)

	return candidates[0]?.runDir ?? null
}

function resolveOwnerRunContext(workspace: string, preferredRunId?: string | null): OwnerRunContext {
	const runDir = pickPreferredRunDir(workspace, preferredRunId)
	if (!runDir) {
		return {
			runDir: null,
			runId: null,
			summaryPath: null,
			summary: null,
			reviewPackPath: null,
			reviewPack: null,
			incidentPackPath: null,
			incidentPack: null,
			events: [],
			lastUpdateMs: 0,
		}
	}

	const summaryPath = resolveRunSummaryPath(runDir)
	const reviewPackPath = resolveReviewPackPath(runDir)
	const incidentPackPath = resolveIncidentPackPath(runDir)
	const summary = readRunSummary(runDir)
	const reviewPack = readReviewPack<ReviewPack>(runDir)
	const incidentPack = readIncidentPack<IncidentPack>(runDir)
	const events = readRunEvents(runDir)
	const runId = asString(summary?.["taskId"]) ?? path.basename(runDir)
	return {
		runDir,
		runId,
		summaryPath: fs.existsSync(summaryPath) ? summaryPath : null,
		summary,
		reviewPackPath: fs.existsSync(reviewPackPath) ? reviewPackPath : null,
		reviewPack,
		incidentPackPath: fs.existsSync(incidentPackPath) ? incidentPackPath : null,
		incidentPack,
		events,
		lastUpdateMs: Math.max(
			readFileMtime(summaryPath),
			readFileMtime(path.join(runDir, "events.ndjson")),
			readFileMtime(reviewPackPath),
			readFileMtime(incidentPackPath),
		),
	}
}

function extractTaskScope(summary: SummaryLike | null): string[] {
	const taskContract = asRecord(summary?.["taskContract"])
	const scope = asRecord(taskContract?.["scope"])
	return [...asStringArray(scope?.["allowedFiles"]), ...asStringArray(scope?.["requiredTargetFiles"])]
}

function isBoundedTask(summary: SummaryLike | null): boolean {
	const pathChosen = asString(summary?.["pathChosen"])
	if (pathChosen === "small_task" || pathChosen === "scoped" || pathChosen === "semi_open") return true
	return extractTaskScope(summary).length > 0
}

function normalizeProviderBucket(bucket: string | null): string | null {
	if (!bucket) return null
	switch (bucket) {
		case "provider_auth_failure":
		case "provider_launch_failure":
			return "provider/config failure"
		case "provider_timeout":
			return "provider timeout"
		case "provider_malformed_response":
			return "provider malformed response"
		case "provider_empty_response":
			return "provider empty response"
		case "provider_transport_failure":
			return "provider transport failure"
		default:
			return bucket.replace(/_/g, " ")
	}
}

function dedupeActions(actions: OwnerQuickAction[]): OwnerQuickAction[] {
	const seen = new Set<string>()
	const deduped: OwnerQuickAction[] = []
	for (const action of actions) {
		const key = [action.id, action.command ?? "", action.label].join("|")
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(action)
	}
	return deduped.sort((left, right) => Number(right.recommended) - Number(left.recommended))
}

function buildSuggestedActions(context: OwnerRunContext, workspace: string): OwnerQuickAction[] {
	const actions: OwnerQuickAction[] = []
	const runId = context.runId
	const summary = context.summary
	const status = asString(summary?.["status"]) ?? "unknown"
	const task = asString(summary?.["task"])
	const reviewPack = context.reviewPack
	const incidentPack = context.incidentPack
	const boundedTask = isBoundedTask(summary)
	const triage = buildIncidentTriage({
		summary,
		incidentPack,
		reviewPack,
	})
	const queueSummary = buildWorkQueueSummary(workspace)

	if (triage && runId) {
		actions.push({
			id: `incident_triage_${triage.category}`,
			label: triage.recommendedLabel,
			rationale: `${triage.label} (${triage.code}): ${triage.rationale}`,
			command:
				incidentPack?.recoveryAction.command ??
				(reviewPack ? buildWorkspaceSubcommand("review:show", workspace, runId) : buildWorkspaceSubcommand("incident:show", workspace, runId)),
			recommended: Boolean(incidentPack) && !reviewPack,
			source: incidentPack ? "incident" : "review",
		})
	}

	if (reviewPack && runId) {
		if (reviewPack.review.canApprove) {
			actions.push({
				id: "approve_review",
				label: reviewPack.nextAction.label,
				rationale: reviewPack.nextAction.rationale,
				command: buildWorkspaceSubcommand("review:approve", workspace, runId),
				recommended: reviewPack.nextAction.label === "approve now" || reviewPack.nextAction.label === "record approval",
				source: "review",
			})
		}

		if (reviewPack.nextAction.label.includes("discard")) {
			actions.push({
				id: "discard_review",
				label: "discard review candidate",
				rationale: reviewPack.nextAction.rationale,
				command: buildWorkspaceSubcommand("review:discard", workspace, runId),
				recommended: reviewPack.nextAction.label.includes("discard"),
				source: "review",
			})
		}

		actions.push({
			id: "open_review_pack",
			label: "open review pack",
			rationale: "Review artifacts remain the source of truth for review-required runs.",
			command: buildWorkspaceSubcommand("review:show", workspace, runId),
			recommended: !reviewPack.review.canApprove,
			source: "review",
		})

		if (reviewPack.nextAction.label === "stop and fix red lane") {
			actions.push({
				id: "stage_fix_red_lane",
				label: "stage FixRedLane session",
				rationale: reviewPack.nextAction.rationale,
				command: buildFixRedLaneSuggestion(context, triage),
				recommended: true,
				source: "review",
			})
		}
	}

	if (incidentPack && runId) {
		if (incidentPack.recoveryAction.command) {
			actions.push({
				id: `incident_${incidentPack.recoveryAction.kind}`,
				label: incidentPack.recoveryAction.label,
				rationale: incidentPack.recoveryAction.rationale,
				command: incidentPack.recoveryAction.command,
				recommended: incidentPack.nextAction.label === incidentPack.recoveryAction.label,
				source: "incident",
			})
		}

		actions.push({
			id: "open_incident_pack",
			label: "open incident pack",
			rationale: "Incident artifacts stay authoritative for cleanup, failure bucket, and next-step evidence.",
			command: buildWorkspaceSubcommand("incident:show", workspace, runId),
			recommended: !incidentPack.recoveryAction.command,
			source: "incident",
		})

		if (incidentPack.redLaneHint.recommended) {
			actions.push({
				id: "stage_fix_red_lane",
				label: "stage FixRedLane session",
				rationale: incidentPack.redLaneHint.rationale,
				command: buildFixRedLaneSuggestion(context, triage),
				recommended: incidentPack.nextAction.label === "stop and fix red lane",
				source: "incident",
			})
		}
	}

	if (task && boundedTask && runId && status === "done") {
		actions.push({
			id: "rerun_same_task",
			label: "rerun the same bounded task",
			rationale: "The last run stayed inside a bounded path, so rerunning the exact same task remains inspectable.",
			command: buildWorkspaceTaskCommand(task, workspace),
			recommended: true,
			source: "summary",
		})
	}

	if (task && boundedTask && runId && status !== "done" && incidentPack && !incidentPack.redLaneHint.recommended) {
		actions.push({
			id: "rerun_same_task",
			label: "rerun the same bounded task",
			rationale: "Retry only after resolving the current artifact-backed blocker first.",
			command: buildWorkspaceTaskCommand(task, workspace),
			recommended: false,
			source: "summary",
		})
	}

	if (runId && actions.length === 0) {
		actions.push({
			id: "inspect_latest_summary",
			label: "inspect the latest summary artifact",
			rationale: "No narrower quick action was derived, so the latest summary is the safest next place to inspect.",
			command: context.summaryPath,
			recommended: true,
			source: "lifecycle",
		})
	}

	if (queueSummary.pendingCount > 0 && (status === "done" || status === "failed" || !runId)) {
		const nextApprovalItem = queueSummary.nextAwaitingApprovalItem
		if (nextApprovalItem) {
			actions.push({
				id: "approve_background_candidate",
				label: "approve queued background candidate",
				rationale: `Queued work stays opt-in; ${nextApprovalItem.queueId} is waiting on explicit owner approval before it can become ready.`,
				command: buildWorkspaceQueueApproveCommand(nextApprovalItem.queueId, workspace),
				recommended: actions.length === 0,
				source: "lifecycle",
			})
		}
		actions.push({
			id: "open_queue",
			label: queueSummary.readyCount > 0 ? "inspect ready queue item" : nextApprovalItem ? "inspect queued approval boundary" : "inspect work queue",
			rationale:
				queueSummary.nextReadyItem
					? `Queued follow-up is ready now: ${queueSummary.nextReadyItem.task}`
					: nextApprovalItem
						? `Queued background candidate ${nextApprovalItem.queueId} is paused until the owner approves it.`
					: queueSummary.nextScheduledItem
						? `A future queued task is staged for ${queueSummary.nextScheduledItem.scheduledAt}.`
						: "Queued follow-up work is staged and still bounded by the artifact-backed queue.",
			command: buildWorkspaceSubcommand(queueSummary.readyCount > 0 ? "queue:next" : "queue:list", workspace),
			recommended: actions.length === 0,
			source: "lifecycle",
		})
	}

	return dedupeActions(actions)
}

function summarizeActiveAgents(events: RunEvent[]): string[] {
	const latestByAgent = new Map<string, string>()
	for (const event of events) {
		const agentId = asString(event["agentId"])
		if (!agentId) continue
		const type = asString(event["type"]) ?? "unknown"
		latestByAgent.set(agentId, type)
	}
	return Array.from(latestByAgent.entries())
		.filter(([, type]) => type === "agent_start" || type === "agent_iteration")
		.map(([agentId]) => agentId)
}

function summarizeActiveWorkItems(events: RunEvent[]): string[] {
	const workItems = new Set<string>()
	for (const event of events) {
		const type = asString(event["type"]) ?? ""
		if (type !== "agent_iteration" && type !== "agent_start") continue
		const agentId = asString(event["agentId"])
		if (agentId) workItems.add(agentId)
	}
	return Array.from(workItems)
}

function resolveLastEventTimestamp(events: RunEvent[], summary: SummaryLike | null): { at: string | null; type: string | null } {
	const latestEvent = events.at(-1) ?? null
	const eventTimestamp = asString(latestEvent?.["timestamp"])
	if (eventTimestamp) {
		return {
			at: eventTimestamp,
			type: asString(latestEvent?.["type"]),
		}
	}
	return {
		at: asString(summary?.["endedAt"]) ?? asString(summary?.["startedAt"]),
		type: summary ? "summary" : null,
	}
}

function resolveRunState(summary: SummaryLike | null, events: RunEvent[]): OwnerLifeSignal["runState"] {
	const status = asString(summary?.["status"])
	if (status === "done" || status === "review_required" || status === "failed") return status
	const started = events.some((event) => asString(event["type"]) === "run_start")
	const ended = events.some((event) => asString(event["type"]) === "run_end")
	if (started && !ended) return "running"
	return summary || events.length > 0 ? "unknown" : "idle"
}

function resolveLiveness(
	runState: OwnerLifeSignal["runState"],
	lastEventAt: string | null,
	nowMs: number,
): OwnerLifeSignal["liveness"] {
	if (runState === "idle") return "not_started"
	if (runState === "done" || runState === "review_required" || runState === "failed") return "finished"
	if (runState !== "running") return "unknown"
	const lastEventMs = lastEventAt ? Date.parse(lastEventAt) : Number.NaN
	if (Number.isNaN(lastEventMs)) return "unknown"
	return nowMs - lastEventMs <= 180_000 ? "alive" : "quiet"
}

function resolveBlockerBucket(context: OwnerRunContext): string | null {
	const summaryStopReason = asString(context.summary?.["stopReason"])
	const summaryStatus = asString(context.summary?.["status"])
	if (summaryStopReason && summaryStatus && summaryStatus !== "done") {
		return classifyStopReason(summaryStopReason).bucket
	}

	const providerFailure = [...context.events]
		.reverse()
		.find((event) => asString(event["type"]) === "provider_failure")
	const providerBucket = normalizeProviderBucket(asString(providerFailure?.["bucket"]))
	if (providerBucket) return providerBucket

	const agentError = [...context.events]
		.reverse()
		.find((event) => asString(event["type"]) === "agent_error")
	if (agentError) return "agent error"
	return null
}

function parseOutcomeBuckets(entries: string[]): { bucket: string; count: number }[] {
	return entries.map((entry) => {
		const separatorIndex = entry.lastIndexOf("=")
		if (separatorIndex === -1) {
			return {
				bucket: entry,
				count: 0,
			}
		}
		const bucket = entry.slice(0, separatorIndex).trim() || "(unknown)"
		const count = Number(entry.slice(separatorIndex + 1)) || 0
		return { bucket, count }
	})
}

export function buildOwnerQuickActions(workspace: string, options: { preferredRunId?: string | null } = {}): OwnerQuickActionSet {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace || !fs.existsSync(normalizedWorkspace)) {
		return {
			workspace: normalizedWorkspace,
			runId: null,
			summaryPath: null,
			reviewPackPath: null,
			incidentPackPath: null,
			recommendedAction: null,
			redLaneRecommended: false,
			triage: null,
			actions: [],
		}
	}

	const context = resolveOwnerRunContext(normalizedWorkspace, options.preferredRunId)
	const actions = buildSuggestedActions(context, normalizedWorkspace)
	const triage = buildIncidentTriage({
		summary: context.summary,
		incidentPack: context.incidentPack,
		reviewPack: context.reviewPack,
	})
	return {
		workspace: normalizedWorkspace,
		runId: context.runId,
		summaryPath: context.summaryPath,
		reviewPackPath: context.reviewPackPath,
		incidentPackPath: context.incidentPackPath,
		triage,
		recommendedAction: actions.find((action) => action.recommended) ?? actions[0] ?? null,
		redLaneRecommended: actions.some((action) => action.id === "stage_fix_red_lane"),
		actions,
	}
}

export function formatOwnerQuickActions(actionSet: OwnerQuickActionSet): string {
	if (actionSet.actions.length === 0) {
		return "Owner quick actions: no artifact-backed follow-up actions are available yet."
	}

	return [
		"Owner quick actions:",
		...(actionSet.triage ? [formatIncidentTriage(actionSet.triage)] : []),
		...actionSet.actions.map((action) =>
			[
				`- ${action.label}${action.recommended ? " [recommended]" : ""}`,
				`  Why: ${action.rationale}`,
				`  Command: ${action.command ?? "(inspect the referenced artifact manually)"}`,
			].join("\n"),
		),
	].join("\n")
}

export function formatOwnerQuickActionsInline(actionSet: OwnerQuickActionSet, maxActions = 2): string {
	if (actionSet.actions.length === 0) return "Quick actions: no artifact-backed follow-up actions yet."
	const lines = ["Quick actions:"]
	if (actionSet.triage) lines.push(`Triage: ${actionSet.triage.label}`)
	for (const action of actionSet.actions.slice(0, Math.max(1, maxActions))) {
		lines.push(`- ${action.label}${action.command ? ` -> ${action.command}` : ""}`)
	}
	return lines.join("\n")
}

export function buildOwnerLifeSignal(
	workspace: string,
	options: { preferredRunId?: string | null; nowMs?: number } = {},
): OwnerLifeSignal {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace || !fs.existsSync(normalizedWorkspace)) {
		return {
			workspace: normalizedWorkspace,
			runId: null,
			runState: "idle",
			liveness: "not_started",
			lastEventAt: null,
			lastEventType: null,
			activeAgents: [],
			activeWorkItems: [],
			blockerBucket: null,
			campaignId: null,
			campaignAttemptNumber: null,
			campaignRunCount: 0,
			campaignQueuedCount: 0,
			campaignNextQueuedTask: null,
			queuePendingCount: 0,
			queueReadyCount: 0,
			queueAwaitingApprovalCount: 0,
			queueScheduledCount: 0,
			queueState: "empty",
			queueSummary: "No queued follow-up work is recorded.",
			queueNextCommand: null,
			nextQueuedTask: null,
			nextQueuedApprovalTask: null,
			outcomeWindowRuns: 0,
			outcomeDoneRuns: 0,
			outcomeReviewRequiredRuns: 0,
			outcomeFailedRuns: 0,
			outcomeSuccessRate: null,
			outcomeFailureBuckets: [],
			nextSuggestedAction: "pick a real small clean repo, then use Guided mode and run Check Admission",
			nextSuggestedCommand: null,
			nextSuggestedRationale: "Life-signal status becomes useful only after the owner points the shell at a real supported workspace.",
			summaryPath: null,
			runtimeVisibilityHeadline: "No runtime progress summary recorded yet.",
			runtimeVisibilitySummary: "no runtime progress summary recorded yet",
			recoveryLoop: null,
		}
	}

	const context = resolveOwnerRunContext(normalizedWorkspace, options.preferredRunId)
	const { at: lastEventAt, type: lastEventType } = resolveLastEventTimestamp(context.events, context.summary)
	const runState = resolveRunState(context.summary, context.events)
	const quickActions = buildOwnerQuickActions(normalizedWorkspace, { preferredRunId: context.runId })
	const recommendedAction = quickActions.recommendedAction
	const queueSummary = buildWorkQueueSummary(normalizedWorkspace, options.nowMs ?? Date.now())
	const campaignSummary = context.runId ? resolveCampaignSummary(normalizedWorkspace, context.runId) : null
	const outcomeSnapshot = buildOwnerOutcomeSnapshot(normalizedWorkspace)
	const runtimeVisibility = buildRuntimeVisibilitySnapshot(context.summary, normalizedWorkspace, runState, context.summaryPath)
	const suggestedAction =
		runState === "running"
			? {
					label: "wait for the current run to finish",
					command: null,
					rationale: "The latest run still has live events, so the safest next step is to watch the current artifact stream.",
				}
			: runState === "idle"
				? recommendedAction
					? {
							label: recommendedAction.label,
							command: recommendedAction.command,
							rationale: recommendedAction.rationale,
						}
					: {
							label: "use Guided mode and run Check Admission",
							command: null,
							rationale: "No run artifacts exist yet, so the calm default is to start with a bounded guided task and preflight it before launch.",
						}
				: recommendedAction
					? {
							label: recommendedAction.label,
							command: recommendedAction.command,
							rationale: recommendedAction.rationale,
						}
					: {
							label: "inspect the latest summary artifact",
							command: context.summaryPath,
							rationale: "No narrower artifact-backed follow-up action was derived.",
						}
	return {
		workspace: normalizedWorkspace,
		runId: context.runId,
		runState,
		liveness: resolveLiveness(runState, lastEventAt, options.nowMs ?? Date.now()),
		lastEventAt,
		lastEventType,
		activeAgents: summarizeActiveAgents(context.events),
		activeWorkItems: summarizeActiveWorkItems(context.events),
		blockerBucket: resolveBlockerBucket(context),
		campaignId: campaignSummary?.campaignId ?? null,
		campaignAttemptNumber: campaignSummary?.attemptNumber ?? null,
		campaignRunCount: campaignSummary?.runCount ?? 0,
		campaignQueuedCount: campaignSummary?.queuedCount ?? 0,
		campaignNextQueuedTask: campaignSummary?.nextQueuedTask ?? null,
		queuePendingCount: queueSummary.pendingCount,
		queueReadyCount: queueSummary.readyCount,
		queueAwaitingApprovalCount: queueSummary.awaitingApprovalCount,
		queueScheduledCount: queueSummary.scheduledCount,
		queueState: queueSummary.state,
		queueSummary: queueSummary.statusMessage,
		queueNextCommand: queueSummary.nextCommandHint,
		nextQueuedTask: queueSummary.nextReadyItem?.task ?? queueSummary.nextScheduledItem?.task ?? queueSummary.nextAwaitingApprovalItem?.task ?? null,
		nextQueuedApprovalTask: queueSummary.nextAwaitingApprovalItem?.task ?? null,
		outcomeWindowRuns: outcomeSnapshot.windowRuns,
		outcomeDoneRuns: outcomeSnapshot.doneRuns,
		outcomeReviewRequiredRuns: outcomeSnapshot.reviewRequiredRuns,
		outcomeFailedRuns: outcomeSnapshot.failedRuns,
		outcomeSuccessRate: outcomeSnapshot.successRate,
		outcomeFailureBuckets: outcomeSnapshot.failureBuckets.map((bucket) => `${bucket.bucket}=${bucket.count}`),
		nextSuggestedAction: suggestedAction.label,
		nextSuggestedCommand: suggestedAction.command,
		nextSuggestedRationale: suggestedAction.rationale,
		summaryPath: context.summaryPath,
		runtimeVisibilityHeadline: runtimeVisibility.focusHeadline,
		runtimeVisibilitySummary: runtimeVisibility.progressSummary,
		recoveryLoop: runtimeVisibility.recoveryLoop ?? formatQueenshiftRecoveryLoop(runState),
	}
}

export function formatOwnerLifeSignal(signal: OwnerLifeSignal): string {
	const outcomeText = formatOwnerOutcomeDashboard({
		windowRuns: signal.outcomeWindowRuns,
		doneRuns: signal.outcomeDoneRuns,
		reviewRequiredRuns: signal.outcomeReviewRequiredRuns,
		failedRuns: signal.outcomeFailedRuns,
		successRate: signal.outcomeSuccessRate,
		failureBuckets: parseOutcomeBuckets(signal.outcomeFailureBuckets),
	})
	return [
		`Run state: ${signal.runState.toUpperCase()}`,
		`Liveness: ${signal.liveness}`,
		`Run ID: ${signal.runId ?? "(none)"}`,
		`Last event: ${signal.lastEventAt ?? "(none recorded)"}${signal.lastEventType ? ` (${signal.lastEventType})` : ""}`,
		`Active agents: ${signal.activeAgents.join(", ") || "(none)"}`,
		`Active work items: ${signal.activeWorkItems.join(", ") || "(none)"}`,
		`Blocker bucket: ${signal.blockerBucket ?? "(none)"}`,
		`Campaign: ${signal.campaignId ? `${signal.campaignId} attempt=${signal.campaignAttemptNumber ?? "?"} runs=${signal.campaignRunCount} queued=${signal.campaignQueuedCount} next=${signal.campaignNextQueuedTask ?? "(none)"}` : "(none)"}`,
		`Queue: pending=${signal.queuePendingCount} ready=${signal.queueReadyCount} awaiting_approval=${signal.queueAwaitingApprovalCount} scheduled=${signal.queueScheduledCount} state=${signal.queueState} next=${signal.nextQueuedTask ?? "(none)"}${signal.nextQueuedApprovalTask ? ` approval_next=${signal.nextQueuedApprovalTask}` : ""}`,
		`Queue note: ${signal.queueSummary}`,
		`Queue command: ${signal.queueNextCommand ?? "(none)"}`,
		`Current focus: ${signal.runtimeVisibilityHeadline}`,
		`Visible progress: ${signal.runtimeVisibilitySummary}`,
		...(signal.recoveryLoop ? [`Recovery loop: ${signal.recoveryLoop}`] : []),
		outcomeText,
		formatLowSteeringOwnerLoop(signal.workspace),
		`Next suggested action: ${signal.nextSuggestedAction}`,
		`Next command: ${signal.nextSuggestedCommand ?? "(none)"}`,
		`Why: ${signal.nextSuggestedRationale}`,
		`Summary: ${signal.summaryPath ?? "(none)"}`,
	].join("\n")
}

export function formatOwnerLifeSignalInline(signal: OwnerLifeSignal): string {
	const outcomeText = formatOwnerOutcomeDashboardInline({
		windowRuns: signal.outcomeWindowRuns,
		doneRuns: signal.outcomeDoneRuns,
		reviewRequiredRuns: signal.outcomeReviewRequiredRuns,
		failedRuns: signal.outcomeFailedRuns,
		successRate: signal.outcomeSuccessRate,
		failureBuckets: parseOutcomeBuckets(signal.outcomeFailureBuckets),
	})
	return [
		`Life signal: ${signal.runState.toUpperCase()} (${signal.liveness})`,
		`Last event: ${signal.lastEventAt ?? "(none recorded)"}${signal.lastEventType ? ` (${signal.lastEventType})` : ""}`,
		`Active agents: ${signal.activeAgents.join(", ") || "(none)"}`,
		`Blocker bucket: ${signal.blockerBucket ?? "(none)"}`,
		`Campaign: ${signal.campaignId ? `${signal.campaignId} attempt=${signal.campaignAttemptNumber ?? "?"} runs=${signal.campaignRunCount} queued=${signal.campaignQueuedCount}` : "(none)"}`,
		`Queue: pending=${signal.queuePendingCount} ready=${signal.queueReadyCount} awaiting_approval=${signal.queueAwaitingApprovalCount} scheduled=${signal.queueScheduledCount} state=${signal.queueState}`,
		`Queue note: ${signal.queueSummary}`,
		`Queue command: ${signal.queueNextCommand ?? "(none)"}`,
		`Current focus: ${signal.runtimeVisibilityHeadline}`,
		`Visible progress: ${signal.runtimeVisibilitySummary}`,
		...(signal.recoveryLoop ? [`Recovery loop: ${signal.recoveryLoop}`] : []),
		outcomeText,
		formatLowSteeringOwnerLoop(signal.workspace),
		`Next suggested action: ${signal.nextSuggestedAction}`,
		`Next command: ${signal.nextSuggestedCommand ?? "(none)"}`,
	].join("\n")
}
