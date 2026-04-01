import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import {
	findLatestRunSummary,
	readReplayArtifact as readReplayArtifactRecord,
	readRunEvents,
	resolveReplayArtifactPath,
	resolveRunDir,
	resolveRunSummaryPath,
	type RunEvent,
} from "./RunArtifacts"
import { buildReplayLearnedImprovement, type ReplayLearnedImprovement } from "./ReplayLearning"

export type ReplayStage = "setup" | "planning" | "execution" | "review" | "outcome"

export type ReplayGateMode = "deterministic" | "live"

export type ReplayEntry = {
	index: number
	at: string | null
	stage: ReplayStage
	type: string
	title: string
	details: string[]
}

export type ReplayOverview = {
	planningSummary: string
	coordinationSummary: string
	reviewSummary: string
	artifactSummary: string
	highlights: string[]
}

export type ReplayReproducibilityFacts = {
	gateMode: ReplayGateMode
	lane: string | null
	surface: string | null
	profileManifestHash: string | null
	scopeFiles: string[]
	changedFiles: string[]
	status: string
	stopReason: string
	reviewerVerdict: string | null
	acceptance: string
	verification: string
}

export type ReplayReproducibility = {
	comparisonKey: string
	outcomeKey: string
	facts: ReplayReproducibilityFacts
	summary: string
	guidance: string[]
}

export type ReplayArtifact = {
	schemaVersion: 1
	runId: string
	task: string
	status: string
	stopReason: string
	pathChosen: string | null
	gateMode: ReplayGateMode
	surface: string | null
	profileManifestHash: string | null
	summaryPath: string
	generatedAt: string
	eventCount: number
	stageCounts: Record<ReplayStage, number>
	overview: ReplayOverview
	reproducibility: ReplayReproducibility
	learning: ReplayLearnedImprovement
	entries: ReplayEntry[]
}

export type ReplayComparisonResult = {
	comparable: boolean
	comparisonKey: string | null
	outcomeMatch: boolean
	alignedSignals: string[]
	divergentSignals: string[]
	summary: string
}

export type ReplayExportResult = {
	found: boolean
	runId: string | null
	summaryPath: string | null
	replayPath: string | null
	replay: ReplayArtifact | null
	error: string | null
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
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function normalizeReplayPath(value: string): string {
	return value.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function normalizeReplayPathList(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => normalizeReplayPath(value)).filter(Boolean))).sort((left, right) =>
		left.localeCompare(right),
	)
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`
	}
	return JSON.stringify(value)
}

function hashReplayPayload(value: unknown): string {
	return crypto.createHash("sha256").update(stableSerialize(value)).digest("hex")
}

function arraysEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function formatReplayList(value: string[]): string {
	return value.length > 0 ? value.join(", ") : "(none)"
}

function formatAcceptanceStatus(value: unknown): string {
	const acceptanceGate = asRecord(value)
	if (!acceptanceGate) return "not recorded"
	if (acceptanceGate["passed"] === true) return "passed"
	const failedChecks = asStringArray(acceptanceGate["failedChecks"])
	return failedChecks.length > 0 ? `failed:${failedChecks.join(",")}` : "failed"
}

function formatVerificationStatus(value: unknown): string {
	const verification = asRecord(value)
	if (!verification) return "not recorded"
	const status = asString(verification["status"]) ?? "unknown"
	const profileName = asString(verification["profileName"])
	return profileName ? `${profileName}:${status}` : status
}

function formatTargetedEvaluatorStatus(value: unknown): string {
	const artifact = asRecord(value)
	if (!artifact) return "not recorded"
	const status = asString(artifact["status"]) ?? "unknown"
	const applicable = asNumber(artifact["applicableEvaluatorCount"]) ?? 0
	const concerns = asNumber(artifact["concernCount"]) ?? 0
	return applicable > 0 ? `${status}:${concerns}/${applicable}` : status
}

function collectReplayScopeFiles(summary: Record<string, unknown>): string[] {
	const taskContract = asRecord(summary["taskContract"])
	const scope = asRecord(taskContract?.["scope"])
	const allowedFiles = normalizeReplayPathList(asStringArray(scope?.["allowedFiles"]))
	const requiredTargetFiles = normalizeReplayPathList(asStringArray(scope?.["requiredTargetFiles"]))
	const scopeFiles = normalizeReplayPathList([...allowedFiles, ...requiredTargetFiles])
	return scopeFiles.length > 0 ? scopeFiles : normalizeReplayPathList(asStringArray(summary["changedFiles"]))
}

function buildReplayReproducibilityFromFacts(facts: ReplayReproducibilityFacts): ReplayReproducibility {
	const normalizedFacts: ReplayReproducibilityFacts = {
		...facts,
		scopeFiles: normalizeReplayPathList(facts.scopeFiles),
		changedFiles: normalizeReplayPathList(facts.changedFiles),
	}
	const comparisonKey = hashReplayPayload({
		gateMode: normalizedFacts.gateMode,
		lane: normalizedFacts.lane,
		surface: normalizedFacts.surface,
		profileManifestHash: normalizedFacts.profileManifestHash,
		scopeFiles: normalizedFacts.scopeFiles,
	})
	const outcomeKey = hashReplayPayload({
		status: normalizedFacts.status,
		stopReason: normalizedFacts.stopReason,
		reviewerVerdict: normalizedFacts.reviewerVerdict,
		acceptance: normalizedFacts.acceptance,
		verification: normalizedFacts.verification,
		changedFiles: normalizedFacts.changedFiles,
	})
	const scopeLabel = normalizedFacts.scopeFiles.length > 0 ? normalizedFacts.scopeFiles.join(", ") : "scope not recorded"
	const changedFilesLabel =
		normalizedFacts.changedFiles.length > 0 ? normalizedFacts.changedFiles.join(", ") : "changed files not recorded"
	const summary = `Compare reruns only when gate=${normalizedFacts.gateMode}, lane=${normalizedFacts.lane ?? "unknown"}, surface=${normalizedFacts.surface ?? "unknown"}, manifest=${normalizedFacts.profileManifestHash ?? "none"}, and scope=${scopeLabel}; this run ended ${normalizedFacts.status}/${normalizedFacts.stopReason} with verdict=${normalizedFacts.reviewerVerdict ?? "missing"}, acceptance=${normalizedFacts.acceptance}, verification=${normalizedFacts.verification}, changedFiles=${changedFilesLabel}.`
	const guidance = Array.from(
		new Set(
			[
				"Use the comparison key only for reruns that keep gate mode, lane, surface, profile manifest hash, and bounded scope aligned.",
				normalizedFacts.scopeFiles.length > 0
					? "Keep task-contract scope explicit so changed-file divergence can be explained without redefining the comparison group."
					: "Record explicit task-contract scope on future runs so repeated-run comparison does not fall back to changed-file guesses.",
				normalizedFacts.gateMode === "live"
					? "Live runs can still diverge under the same comparison key; treat outcome mismatches as investigation targets, not broken determinism promises."
					: "Deterministic dry-run mismatches under the same comparison key usually point to fixture, planner, or summary drift worth inspecting.",
				"Inspect changed files, reviewer verdict, acceptance, and verification before widening the task or claiming instability.",
			].filter((entry): entry is string => Boolean(entry)),
		),
	)

	return {
		comparisonKey,
		outcomeKey,
		facts: normalizedFacts,
		summary,
		guidance,
	}
}

function buildReplayReproducibility(summary: Record<string, unknown>): ReplayReproducibility {
	return buildReplayReproducibilityFromFacts({
		gateMode: summary["dryRun"] === true ? "deterministic" : "live",
		lane: asString(summary["pathChosen"]),
		surface: asString(summary["surface"]),
		profileManifestHash: asString(summary["profileManifestHash"]),
		scopeFiles: collectReplayScopeFiles(summary),
		changedFiles: normalizeReplayPathList(asStringArray(summary["changedFiles"])),
		status: asString(summary["status"]) ?? "unknown",
		stopReason: asString(summary["stopReason"]) ?? "unknown",
		reviewerVerdict: asString(summary["reviewerVerdict"]),
		acceptance: formatAcceptanceStatus(summary["acceptanceGate"]),
		verification: formatVerificationStatus(summary["verificationProfile"]),
	})
}

function buildReplayReproducibilityFromReplay(replay: ReplayArtifact): ReplayReproducibility {
	return buildReplayReproducibilityFromFacts({
		gateMode: replay.reproducibility?.facts.gateMode ?? replay.gateMode,
		lane: replay.reproducibility?.facts.lane ?? replay.pathChosen,
		surface: replay.reproducibility?.facts.surface ?? replay.surface,
		profileManifestHash: replay.reproducibility?.facts.profileManifestHash ?? replay.profileManifestHash,
		scopeFiles: replay.reproducibility?.facts.scopeFiles ?? [],
		changedFiles: replay.reproducibility?.facts.changedFiles ?? [],
		status: replay.reproducibility?.facts.status ?? replay.status,
		stopReason: replay.reproducibility?.facts.stopReason ?? replay.stopReason,
		reviewerVerdict: replay.reproducibility?.facts.reviewerVerdict ?? null,
		acceptance: replay.reproducibility?.facts.acceptance ?? "not recorded",
		verification: replay.reproducibility?.facts.verification ?? "not recorded",
	})
}

function buildReplayOverview(summary: Record<string, unknown>): ReplayOverview {
	const plan = asRecord(summary["plan"])
	const mergeOrder = asRecord(summary["mergeOrder"])
	const mergeNegotiation = asRecord(mergeOrder?.["negotiation"])
	const progressMap = asRecord(summary["progressMap"])
	const criticLane = asRecord(summary["criticLane"])
	const targetedEvaluators = asRecord(summary["targetedEvaluators"])
	const retryPlanner = asRecord(summary["retryPlanner"])
	const campaign = asRecord(summary["campaign"])
	const workItems = Array.isArray(plan?.["workItems"]) ? plan?.["workItems"].length : 0
	const mergeStatus = asString(mergeOrder?.["status"]) ?? "not recorded"
	const mergeMode = asString(mergeNegotiation?.["mode"]) ?? "not recorded"
	const campaignId = asString(campaign?.["campaignId"])
	const attemptNumber = asNumber(campaign?.["attemptNumber"])
	const planningSummary = `lane=${asString(summary["pathChosen"]) ?? "unknown"} workItems=${workItems} merge=${mergeStatus}/${mergeMode}${campaignId ? ` campaign=${campaignId}${typeof attemptNumber === "number" ? `#${attemptNumber}` : ""}` : ""}`
	const coordinationSummary = progressMap
		? `ready=${formatReplayList(asStringArray(progressMap["readyAssignmentIds"]))} blocked=${formatReplayList(asStringArray(progressMap["blockedAssignmentIds"]))} released=${formatReplayList(asStringArray(progressMap["releasedAssignmentIds"]))} stages=${asNumber(progressMap["stageCount"]) ?? 0}`
		: "ready=(not recorded) blocked=(not recorded) released=(not recorded) stages=0"
	const reviewSummary = [
		`critic=${asString(criticLane?.["status"]) ?? "not recorded"}`,
		`evaluators=${formatTargetedEvaluatorStatus(summary["targetedEvaluators"])}`,
		`verdict=${asString(summary["reviewerVerdict"]) ?? "missing"}`,
		`acceptance=${formatAcceptanceStatus(summary["acceptanceGate"])}`,
		`verification=${formatVerificationStatus(summary["verificationProfile"])}`,
		`retry=${asString(retryPlanner?.["decision"]) ?? "not recorded"}`,
	].join(" ")
	const subtaskContextPackCount = (() => {
		const contextPacks = asRecord(summary["subtaskContextPackArtifactPaths"])
		return contextPacks ? Object.keys(contextPacks).length : 0
	})()
	const artifactSummary = [
		`contextPack=${asString(summary["contextPackArtifactPath"]) ? "yes" : "no"}`,
		`subtaskContextPacks=${subtaskContextPackCount}`,
		`checkpoints=${asString(summary["checkpointArtifactPath"]) ? "yes" : "no"}`,
		`patternMemory=${asString(summary["patternMemoryArtifactPath"]) ? "yes" : "no"}`,
		`evaluators=${formatTargetedEvaluatorStatus(summary["targetedEvaluators"])}`,
	].join(" ")
	const rawHighlights = [
		asString(mergeNegotiation?.["summary"]),
		progressMap ? `Coordination: ${coordinationSummary}` : null,
		asString(criticLane?.["summary"]),
		asString(targetedEvaluators?.["summary"]),
		`Terminal: ${asString(summary["status"]) ?? "unknown"} (${asString(summary["stopReason"]) ?? "unknown"})`,
	]
	const highlights = Array.from(new Set(rawHighlights.filter((value): value is string => Boolean(value && value.trim().length > 0)))).slice(0, 4)

	return {
		planningSummary,
		coordinationSummary,
		reviewSummary,
		artifactSummary,
		highlights,
	}
}

function classifyReplayStage(eventType: string): ReplayStage {
	switch (eventType) {
		case "guardrails_initialized":
		case "recovery_inventory":
		case "recovery_reconcile":
		case "repo_map_built":
		case "context_pack_built":
		case "pattern_memory_matched":
			return "setup"
		case "plan_built":
		case "assignments_created":
		case "ask_sibling_enabled":
		case "merge_order_planned":
			return "planning"
		case "agent_start":
		case "agent_iteration":
		case "agent_done":
		case "agent_error":
		case "model_call":
		case "provider_failure":
		case "provider_retry":
		case "provider_recovered":
		case "ceiling_reached":
			return "execution"
		case "critic_evaluated":
		case "targeted_evaluators_evaluated":
		case "retry_planner_evaluated":
		case "post_merge_quality_evaluated":
		case "review_decision":
			return "review"
		case "run_end":
			return "outcome"
		default:
			return "execution"
	}
}

function describeReplayEvent(event: RunEvent): { title: string; details: string[] } {
	const eventType = asString(event.type) ?? "unknown_event"
	switch (eventType) {
		case "guardrails_initialized":
			return {
				title: "Guardrails initialized",
				details: [
					`modelCalls<=${asNumber(event.maxModelCalls) ?? "?"}`,
					`estimatedTokens<=${asNumber(event.maxEstimatedTokens) ?? "?"}`,
				],
			}
		case "recovery_inventory":
			return {
				title: "Recovery inventory scanned",
				details: [
					`staleTasks=${asNumber(event.staleTaskCount) ?? 0}`,
					`incompleteArtifacts=${asNumber(event.incompleteRunArtifactCount) ?? 0}`,
				],
			}
		case "recovery_reconcile":
			return {
				title: "Recovery reconciliation finished",
				details: [`reconciledTasks=${asNumber(event.reconciledTaskCount) ?? 0}`],
			}
		case "repo_map_built":
			return {
				title: "Repo map built",
				details: [`files=${asNumber(event.totalFiles) ?? 0}`, `entryPoints=${asNumber(event.entryPointCount) ?? 0}`],
			}
		case "context_pack_built":
			return {
				title: "Context pack built",
				details: [
					`selectedFiles=${asNumber(event.selectedFileCount) ?? 0}`,
					`omittedFiles=${asNumber(event.omittedFileCount) ?? 0}`,
				],
			}
		case "pattern_memory_matched":
			return {
				title: "Pattern memory checked",
				details: [`suggestions=${asNumber(event.suggestedPatternCount) ?? 0}`],
			}
		case "plan_built":
			return {
				title: "Plan built",
				details: [
					`lane=${asString(event.pathChosen) ?? "unknown"}`,
					`workItems=${asNumber(event.workItemCount) ?? 0}`,
				],
			}
		case "assignments_created":
			return {
				title: "Assignments created",
				details: [`assignments=${asNumber(event.assignmentCount) ?? 0}`],
			}
		case "ask_sibling_enabled":
			return {
				title: "Ask-sibling lane enabled",
				details: [`maxExchanges=${asNumber(event.maxExchangesPerWorkItem) ?? 0}`],
			}
		case "merge_order_planned":
			return {
				title: "Merge order planned",
				details: [
					`status=${asString(event.mergeOrderStatus) ?? "unknown"}`,
					`sequence=${asNumber(event.sequenceLength) ?? 0}`,
				],
			}
		case "agent_start":
			return {
				title: `${asString(event.agentId) ?? "agent"} started`,
				details: [`role=${asString(event.role) ?? "agent"}`],
			}
		case "agent_iteration":
			return {
				title: `${asString(event.agentId) ?? "agent"} iteration ${asNumber(event.iteration) ?? 0}`,
				details: [`role=${asString(event.role) ?? "agent"}`],
			}
		case "agent_done":
			return {
				title: `${asString(event.agentId) ?? "agent"} completed`,
				details: [`role=${asString(event.role) ?? "agent"}`],
			}
		case "agent_error":
			return {
				title: `${asString(event.agentId) ?? "agent"} failed`,
				details: [asString(event.reason) ?? "No reason recorded."],
			}
		case "model_call":
			return {
				title: `Model call from ${asString(event.actor) ?? "unknown actor"}`,
				details: [
					`success=${event.success === true ? "yes" : "no"}`,
					`durationMs=${asNumber(event.durationMs) ?? 0}`,
				],
			}
		case "provider_failure":
			return {
				title: "Provider failure recorded",
				details: [
					`bucket=${asString(event.bucket) ?? "unknown"}`,
					`retryable=${event.retryable === true ? "yes" : "no"}`,
				],
			}
		case "provider_retry":
			return {
				title: "Provider retry scheduled",
				details: [`bucket=${asString(event.bucket) ?? "unknown"}`],
			}
		case "provider_recovered":
			return {
				title: "Provider recovered",
				details: [`attempt=${asNumber(event.attempt) ?? 0}`],
			}
		case "ceiling_reached":
			return {
				title: "Guardrail ceiling reached",
				details: [`ceiling=${asString(event.ceiling) ?? "unknown"}`],
			}
		case "critic_evaluated":
			return {
				title: "Critic lane evaluated",
				details: [
					`status=${asString(event.status) ?? "unknown"}`,
					`concerns=${asNumber(event.concernCount) ?? 0}`,
				],
			}
		case "targeted_evaluators_evaluated":
			return {
				title: "Targeted evaluators recorded",
				details: [
					`status=${asString(event.status) ?? "unknown"}`,
					`applicable=${asNumber(event.applicableEvaluatorCount) ?? 0}`,
					`concerns=${asNumber(event.concernCount) ?? 0}`,
				],
			}
		case "retry_planner_evaluated":
			return {
				title: "Retry planner evaluated",
				details: [
					`decision=${asString(event.decision) ?? "unknown"}`,
					`retriesRemaining=${asNumber(event.retriesRemaining) ?? 0}`,
				],
			}
		case "post_merge_quality_evaluated":
			return {
				title: "Post-merge quality evaluated",
				details: [
					`status=${asString(event.status) ?? "unknown"}`,
					`blockers=${asNumber(event.blockerCount) ?? 0}`,
				],
			}
		case "review_decision":
			return {
				title: "Review decision recorded",
				details: [`decision=${asString(event.decision) ?? "unknown"}`],
			}
		case "run_end":
			return {
				title: "Run ended",
				details: [
					`status=${asString(event.status) ?? "unknown"}`,
					`stopReason=${asString(event.stopReason) ?? "unknown"}`,
				],
			}
		default:
			return {
				title: eventType.replace(/_/g, " "),
				details: [],
			}
	}
}

export function buildReplayArtifact(
	runDir: string,
	summaryPath: string,
	summary: Record<string, unknown>,
	events: RunEvent[],
): ReplayArtifact {
	const runId = asString(summary.taskId) ?? path.basename(runDir)
	const entries = events.map((event, index) => {
		const type = asString(event.type) ?? "unknown_event"
		const described = describeReplayEvent(event)
		return {
			index: index + 1,
			at: asString(event.timestamp),
			stage: classifyReplayStage(type),
			type,
			title: described.title,
			details: described.details,
		} satisfies ReplayEntry
	})

	const stageCounts: Record<ReplayStage, number> = {
		setup: 0,
		planning: 0,
		execution: 0,
		review: 0,
		outcome: 0,
	}
	for (const entry of entries) {
		stageCounts[entry.stage] += 1
	}
	const overview = buildReplayOverview(summary)
	const reproducibility = buildReplayReproducibility(summary)

	return {
		schemaVersion: 1,
		runId,
		task: asString(summary.task) ?? "(unknown task)",
		status: asString(summary.status) ?? "unknown",
		stopReason: asString(summary.stopReason) ?? "unknown",
		pathChosen: asString(summary.pathChosen),
		gateMode: summary.dryRun === true ? "deterministic" : "live",
		surface: asString(summary.surface),
		profileManifestHash: asString(summary.profileManifestHash),
		summaryPath,
		generatedAt: new Date().toISOString(),
		eventCount: entries.length,
		stageCounts,
		overview,
		reproducibility,
		learning: buildReplayLearnedImprovement(summary, {
			pathChosen: asString(summary["pathChosen"]),
			overview,
			reproducibility,
		}),
		entries,
	}
}

export function readReplayArtifact(runDir: string): ReplayArtifact | null {
	return readReplayArtifactRecord<ReplayArtifact>(runDir)
}

function normalizeReplayArtifact(
	replay: ReplayArtifact | null,
	summary: Record<string, unknown> | null,
): ReplayArtifact | null {
	if (!replay) return null
	if (replay.overview && replay.learning && replay.reproducibility) return replay
	const normalizedOverview = replay.overview ?? buildReplayOverview(summary ?? {})
	const normalizedReproducibility = replay.reproducibility ?? (summary ? buildReplayReproducibility(summary) : buildReplayReproducibilityFromReplay(replay))
	return {
		...replay,
		overview: normalizedOverview,
		reproducibility: normalizedReproducibility,
		learning:
			replay.learning ??
			buildReplayLearnedImprovement(summary ?? {}, {
				...replay,
				overview: normalizedOverview,
				reproducibility: normalizedReproducibility,
			}),
	}
}

function compareReplayStringSignal(
	label: string,
	left: string | null,
	right: string | null,
	alignedSignals: string[],
	divergentSignals: string[],
): void {
	if (left === right) alignedSignals.push(label)
	else divergentSignals.push(label)
}

function compareReplayArraySignal(
	label: string,
	left: string[],
	right: string[],
	alignedSignals: string[],
	divergentSignals: string[],
): void {
	if (arraysEqual(left, right)) alignedSignals.push(label)
	else divergentSignals.push(label)
}

export function compareReplayArtifacts(
	left: ReplayArtifact | null,
	right: ReplayArtifact | null,
): ReplayComparisonResult {
	if (!left || !right) {
		return {
			comparable: false,
			comparisonKey: null,
			outcomeMatch: false,
			alignedSignals: [],
			divergentSignals: ["artifact_missing"],
			summary: "Replay comparison requires two replay artifacts.",
		}
	}

	const normalizedLeft = normalizeReplayArtifact(left, null)
	const normalizedRight = normalizeReplayArtifact(right, null)
	if (!normalizedLeft || !normalizedRight) {
		return {
			comparable: false,
			comparisonKey: null,
			outcomeMatch: false,
			alignedSignals: [],
			divergentSignals: ["artifact_missing"],
			summary: "Replay comparison requires two replay artifacts.",
		}
	}

	const leftFacts = normalizedLeft.reproducibility.facts
	const rightFacts = normalizedRight.reproducibility.facts
	const alignedSignals: string[] = []
	const divergentInputSignals: string[] = []

	compareReplayStringSignal("gateMode", leftFacts.gateMode, rightFacts.gateMode, alignedSignals, divergentInputSignals)
	compareReplayStringSignal("lane", leftFacts.lane, rightFacts.lane, alignedSignals, divergentInputSignals)
	compareReplayStringSignal("surface", leftFacts.surface, rightFacts.surface, alignedSignals, divergentInputSignals)
	compareReplayStringSignal(
		"profileManifestHash",
		leftFacts.profileManifestHash,
		rightFacts.profileManifestHash,
		alignedSignals,
		divergentInputSignals,
	)
	compareReplayArraySignal("scopeFiles", leftFacts.scopeFiles, rightFacts.scopeFiles, alignedSignals, divergentInputSignals)

	if (
		divergentInputSignals.length > 0 ||
		normalizedLeft.reproducibility.comparisonKey !== normalizedRight.reproducibility.comparisonKey
	) {
		return {
			comparable: false,
			comparisonKey: null,
			outcomeMatch: false,
			alignedSignals,
			divergentSignals: divergentInputSignals,
			summary:
				divergentInputSignals.length > 0
					? `Replay artifacts are not comparable because bounded input signals differ: ${divergentInputSignals.join(", ")}.`
					: "Replay artifacts are not comparable because their recorded comparison keys do not match.",
		}
	}

	const divergentOutcomeSignals: string[] = []
	compareReplayStringSignal("status", leftFacts.status, rightFacts.status, alignedSignals, divergentOutcomeSignals)
	compareReplayStringSignal("stopReason", leftFacts.stopReason, rightFacts.stopReason, alignedSignals, divergentOutcomeSignals)
	compareReplayStringSignal(
		"reviewerVerdict",
		leftFacts.reviewerVerdict,
		rightFacts.reviewerVerdict,
		alignedSignals,
		divergentOutcomeSignals,
	)
	compareReplayStringSignal("acceptance", leftFacts.acceptance, rightFacts.acceptance, alignedSignals, divergentOutcomeSignals)
	compareReplayStringSignal(
		"verification",
		leftFacts.verification,
		rightFacts.verification,
		alignedSignals,
		divergentOutcomeSignals,
	)
	compareReplayArraySignal(
		"changedFiles",
		leftFacts.changedFiles,
		rightFacts.changedFiles,
		alignedSignals,
		divergentOutcomeSignals,
	)

	const outcomeMatch =
		divergentOutcomeSignals.length === 0 &&
		normalizedLeft.reproducibility.outcomeKey === normalizedRight.reproducibility.outcomeKey

	return {
		comparable: true,
		comparisonKey: normalizedLeft.reproducibility.comparisonKey,
		outcomeMatch,
		alignedSignals,
		divergentSignals: divergentOutcomeSignals,
		summary: outcomeMatch
			? "Replay artifacts are comparable and their recorded outcome signals match."
			: `Replay artifacts are comparable but their recorded outcome signals diverged: ${divergentOutcomeSignals.join(", ")}.`,
	}
}

export function resolveReplayExport(workspace: string, requestedRunId: string | "latest" = "latest"): ReplayExportResult {
	let summaryPath: string | null = null
	let runId: string | null = null

	if (requestedRunId === "latest") {
		summaryPath = findLatestRunSummary(workspace)
		runId = summaryPath ? path.basename(path.dirname(summaryPath)) : null
	} else {
		runId = requestedRunId.trim()
		if (!runId) {
			return {
				found: false,
				runId: null,
				summaryPath: null,
				replayPath: null,
				replay: null,
				error: "Replay run id is required.",
			}
		}
		summaryPath = resolveRunSummaryPath(resolveRunDir(workspace, runId))
	}

	if (!summaryPath || !fs.existsSync(summaryPath) || !runId) {
		return {
			found: false,
			runId,
			summaryPath,
			replayPath: null,
			replay: null,
			error: "No matching run summary was found for replay export.",
		}
	}

	const runDir = path.dirname(summaryPath)
	const replayPath = resolveReplayArtifactPath(runDir)
	if (!fs.existsSync(replayPath)) {
		return {
			found: false,
			runId,
			summaryPath,
			replayPath,
			replay: null,
			error: "Replay artifact is missing for this run.",
		}
	}

	const replay = readReplayArtifact(runDir)
	if (!replay) {
		return {
			found: false,
			runId,
			summaryPath,
			replayPath,
			replay: null,
			error: "Replay artifact could not be read.",
		}
	}
	let summary: Record<string, unknown> | null = null
	try {
		summary = asRecord(JSON.parse(fs.readFileSync(summaryPath, "utf8")))
	} catch {
		summary = null
	}
	const normalizedReplay = normalizeReplayArtifact(replay, summary)

	return {
		found: true,
		runId,
		summaryPath,
		replayPath,
		replay: normalizedReplay,
		error: null,
	}
}

export function formatReplayExport(result: ReplayExportResult): string {
	if (!result.found || !result.replay) {
		return [
			`Replay export: FAIL`,
			`Run: ${result.runId ?? "(missing)"}`,
			`Summary: ${result.summaryPath ?? "(missing)"}`,
			`Replay: ${result.replayPath ?? "(missing)"}`,
			`Error: ${result.error ?? "Unknown replay export error."}`,
		].join("\n")
	}

	return [
		`Replay export: PASS`,
		`Run: ${result.replay.runId}`,
		`Task: ${result.replay.task}`,
		`Gate mode: ${result.replay.gateMode}`,
		`Lane: ${result.replay.pathChosen ?? "(unknown)"}`,
		`Terminal status: ${result.replay.status} (${result.replay.stopReason})`,
		`Surface: ${result.replay.surface ?? "(missing)"}`,
		`Profile manifest: ${result.replay.profileManifestHash ?? "(missing)"}`,
		`Summary: ${result.summaryPath ?? "(missing)"}`,
		`Replay: ${result.replayPath ?? "(missing)"}`,
		`Use this replay: inspect the recorded timeline and bounded artifacts before rerunning, reviewing, or reporting the run.`,
		`Recovery loop: incident:latest -> owner:quick-actions -> replay:latest`,
		`Overview:`,
		`- Planning: ${result.replay.overview.planningSummary}`,
		`- Coordination: ${result.replay.overview.coordinationSummary}`,
		`- Review: ${result.replay.overview.reviewSummary}`,
		`- Artifacts: ${result.replay.overview.artifactSummary}`,
		`Reproducibility:`,
		`- Comparison key: ${result.replay.reproducibility.comparisonKey}`,
		`- Outcome key: ${result.replay.reproducibility.outcomeKey}`,
		`- Scope: gate=${result.replay.reproducibility.facts.gateMode} lane=${result.replay.reproducibility.facts.lane ?? "unknown"} surface=${result.replay.reproducibility.facts.surface ?? "unknown"} manifest=${result.replay.reproducibility.facts.profileManifestHash ?? "none"} files=${formatReplayList(result.replay.reproducibility.facts.scopeFiles)}`,
		`- Outcome: status=${result.replay.reproducibility.facts.status} stopReason=${result.replay.reproducibility.facts.stopReason} verdict=${result.replay.reproducibility.facts.reviewerVerdict ?? "missing"} acceptance=${result.replay.reproducibility.facts.acceptance} verification=${result.replay.reproducibility.facts.verification} changedFiles=${formatReplayList(result.replay.reproducibility.facts.changedFiles)}`,
		`- Summary: ${result.replay.reproducibility.summary}`,
		...(result.replay.reproducibility.guidance.length > 0
			? result.replay.reproducibility.guidance.map((entry) => `- Guidance: ${entry}`)
			: ["- Guidance: none recorded"]),
		`Learning:`,
		`- Eligible: ${result.replay.learning.eligible ? "yes" : "no"}`,
		`- Source: ${result.replay.learning.source}`,
		`- Summary: ${result.replay.learning.summary}`,
		...(result.replay.learning.lessons.length > 0
			? result.replay.learning.lessons.map((lesson) => `- Lesson: ${lesson}`)
			: ["- Lesson: none recorded"]),
		`- Guardrail: ${result.replay.learning.guardrail}`,
		`Highlights:`,
		...(result.replay.overview.highlights.length > 0
			? result.replay.overview.highlights.map((highlight) => `- ${highlight}`)
			: ["- none recorded"]),
		`Timeline:`,
		...result.replay.entries.map((entry) => {
			const details = entry.details.length > 0 ? ` | ${entry.details.join(" | ")}` : ""
			return `- [${entry.stage}] ${entry.title}${entry.at ? ` @ ${entry.at}` : ""}${details}`
		}),
	].join("\n")
}

export function buildReplayArtifactFromRun(runDir: string, summaryPath: string): ReplayArtifact | null {
	const summary = asRecord(JSON.parse(fs.readFileSync(summaryPath, "utf8")))
	if (!summary) return null
	return buildReplayArtifact(runDir, summaryPath, summary, readRunEvents(runDir))
}
