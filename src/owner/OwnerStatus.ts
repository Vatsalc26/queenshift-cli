import {
	describeRc1NonCreditReason,
	findDailyDriverEntryByRunId,
	readDailyDriverLog,
	summarizeDailyDriverProgress,
	type DailyDriverEntry,
	type Rc1DailyDriverStatus,
} from "../release/Rc1Ops"
import type { OwnerProviderSelection } from "./ProviderResolution"
import { formatOwnerCacheStatus } from "./OwnerCache"
import { buildOwnerLifeSignal, buildOwnerQuickActions, formatOwnerLifeSignalInline, formatOwnerQuickActionsInline } from "./OwnerFollowUp"
import { formatLowSteeringOwnerLoop } from "./LowSteeringOwnerPath"

export type OwnerShellStatusInput = {
	rootDir: string
	workspace: string
	surface: string
	providerSelection: OwnerProviderSelection
	admissionText: string
	latestRunId?: string | null
}

export type OwnerRc1Snapshot = {
	parseError: string | null
	status: Rc1DailyDriverStatus
	latestRealCreditedRun: DailyDriverEntry | null
}

function entryTimeMs(entry: DailyDriverEntry): number {
	const preferred = [entry.endedAt, entry.recordedAt]
	for (const candidate of preferred) {
		if (!candidate) continue
		const parsed = Date.parse(candidate)
		if (!Number.isNaN(parsed)) return parsed
	}
	return 0
}

function parseAdmissionHeadline(admissionText: string): string {
	const lines = admissionText
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
	const admissionDecision = lines.find((line) => line.startsWith("Admission decision: "))
	const repoReadiness = lines.find((line) => line.startsWith("Repo readiness: "))
	const taskAdmission = lines.find((line) => line.startsWith("Task admission: "))
	if (!admissionDecision && !repoReadiness && !taskAdmission) {
		return "Admission: run Check Admission before launch."
	}
	return [admissionDecision, repoReadiness, taskAdmission].filter(Boolean).join(" | ")
}

function formatLatestCreditDecision(entry: DailyDriverEntry | null): string {
	if (!entry) return "Latest RC1 credit: no recorded decision for this run yet."
	return `Latest RC1 credit: ${entry.credited ? "credited" : "rejected"} -> ${entry.notes ?? "no reason recorded"}`
}

export function buildOwnerShellStatusText(input: OwnerShellStatusInput): string {
	const workspace = input.workspace.trim()
	const lines: string[] = []
	const providerRetries = input.providerSelection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1"
	const providerBackoffMs = input.providerSelection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500"
	const providerTimeoutMs = input.providerSelection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000"

	lines.push(`Workspace: ${workspace || "(select a workspace)"}`)
	lines.push(parseAdmissionHeadline(input.admissionText))
	lines.push(`Provider: ${input.providerSelection.provider ?? "not ready"}${input.providerSelection.authMode ? ` (${input.providerSelection.authMode})` : ""}`)
	lines.push(`Model: ${input.providerSelection.model ?? "(not set)"}`)
	lines.push(`Provider source: ${input.providerSelection.source}`)
	lines.push(`Provider transport: ${input.providerSelection.transport}`)
	lines.push(`Provider retry policy: ${providerRetries} retry attempt(s), ${providerBackoffMs}ms base backoff, ${providerTimeoutMs}ms timeout`)
	lines.push(`Provider transport note: ${input.providerSelection.transportNote}`)
	lines.push(`Provider note: ${input.providerSelection.reason}`)

	if (!workspace) {
		lines.push("RC1 credit surface: select a workspace first.")
		lines.push("Latest RC1 credit: no run launched yet.")
		lines.push(formatLowSteeringOwnerLoop())
		lines.push("Calm default: pick a small clean repo, stay in Guided mode, and run Check Admission before launch.")
		lines.push(formatOwnerCacheStatus(input.rootDir))
		return lines.join("\n")
	}

	const nonCreditReason = describeRc1NonCreditReason(input.rootDir, workspace, input.surface)
	lines.push(
		nonCreditReason
			? `RC1 credit surface: non-credit -> ${nonCreditReason}`
			: "RC1 credit surface: credit-eligible if the run finishes done/PASS/passed/manualRepair=false and stays within the daily cap.",
	)

	const latestEntry = input.latestRunId ? findDailyDriverEntryByRunId(input.rootDir, input.latestRunId) : null
	const rc1Snapshot = readOwnerRc1Snapshot(input.rootDir)
	lines.push(
		`RC1 progress: ${rc1Snapshot.status.creditedCount}/${rc1Snapshot.status.requiredCreditedRuns} runs, ${rc1Snapshot.status.distinctDateCount}/${rc1Snapshot.status.requiredDistinctDates} dates`,
	)
	lines.push(
		rc1Snapshot.status.currentDateAtCap
			? `RC1 date status: ${rc1Snapshot.status.currentDate} is full; next eligible credited date is ${rc1Snapshot.status.nextEligibleDate ?? rc1Snapshot.status.currentDate}.`
			: `RC1 date status: ${rc1Snapshot.status.currentDate} has ${Math.max(0, rc1Snapshot.status.maxCreditedRunsPerDay - rc1Snapshot.status.currentDateCreditedCount)} credited slot(s) left.`,
	)
	lines.push(formatLatestCreditDecision(latestEntry))
	lines.push(formatOwnerCacheStatus(input.rootDir))
	const lifeSignal = buildOwnerLifeSignal(workspace, { preferredRunId: input.latestRunId })
	const quickActions = buildOwnerQuickActions(workspace, { preferredRunId: input.latestRunId })
	lines.push(formatOwnerLifeSignalInline(lifeSignal))
	lines.push(formatOwnerQuickActionsInline(quickActions))
	lines.push(formatLowSteeringOwnerLoop(workspace))
	lines.push(`Calm default: ${lifeSignal.nextSuggestedAction}${lifeSignal.nextSuggestedCommand ? ` -> ${lifeSignal.nextSuggestedCommand}` : ""}`)
	return lines.join("\n")
}

export function readOwnerRc1Snapshot(rootDir: string): OwnerRc1Snapshot {
	const readResult = readDailyDriverLog(rootDir)
	if (readResult.parseError || !readResult.log) {
		return {
			parseError: readResult.parseError ?? null,
			status: summarizeDailyDriverProgress({ version: 1, entries: [] }),
			latestRealCreditedRun: null,
		}
	}

	const latestRealCreditedRun =
		[...readResult.log.entries]
			.filter((entry) => entry.credited === true)
			.filter((entry) => !describeRc1NonCreditReason(rootDir, entry.workspace, entry.surface))
			.sort((left, right) => entryTimeMs(right) - entryTimeMs(left))[0] ?? null

	return {
		parseError: null,
		status: summarizeDailyDriverProgress(readResult.log),
		latestRealCreditedRun,
	}
}
