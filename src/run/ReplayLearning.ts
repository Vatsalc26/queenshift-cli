import fs from "node:fs"
import path from "node:path"

export type ReplayLearningSource = "replay_artifact" | "summary_replay_overview" | "summary_fallback" | "not_accepted"

export type ReplayLearnedImprovement = {
	eligible: boolean
	source: ReplayLearningSource
	summary: string
	pathChosen: string | null
	scopeSize: number
	verificationProfile: string | null
	lessons: string[]
	highlights: string[]
	guardrail: string
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

function truncate(value: string, maxLength = 120): string {
	return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function extractScopeSize(summary: Record<string, unknown> | null): number {
	const taskContract = asRecord(summary?.["taskContract"])
	const scope = asRecord(taskContract?.["scope"])
	const allowedFiles = asStringArray(scope?.["allowedFiles"])
	const requiredTargetFiles = asStringArray(scope?.["requiredTargetFiles"])
	const changedFiles = asStringArray(summary?.["changedFiles"])
	return Math.max(allowedFiles.length, requiredTargetFiles.length, changedFiles.length)
}

function extractVerificationProfile(summary: Record<string, unknown> | null): string | null {
	const verificationProfile = asRecord(summary?.["verificationProfile"])
	return asString(verificationProfile?.["profileName"]) ?? asString(verificationProfile?.["message"])
}

function acceptedRun(summary: Record<string, unknown> | null): boolean {
	if (!summary) return false
	if (asString(summary["status"]) !== "done") return false
	const acceptanceGate = asRecord(summary["acceptanceGate"])
	if (acceptanceGate && acceptanceGate["passed"] !== true) return false
	return true
}

function resolveReplayOverview(
	summary: Record<string, unknown> | null,
	replay: Record<string, unknown> | null,
): { source: ReplayLearningSource; overview: Record<string, unknown> | null } {
	const replayOverview = asRecord(replay?.["overview"])
	if (replayOverview) {
		return {
			source: "replay_artifact",
			overview: replayOverview,
		}
	}

	const summaryReplayOverview = asRecord(summary?.["replayOverview"])
	if (summaryReplayOverview) {
		return {
			source: "summary_replay_overview",
			overview: summaryReplayOverview,
		}
	}

	return {
		source: "summary_fallback",
		overview: null,
	}
}

export function buildReplayLearnedImprovement(
	summary: Record<string, unknown> | null,
	replay: Record<string, unknown> | null,
): ReplayLearnedImprovement {
	const accepted = acceptedRun(summary)
	const pathChosen = asString(replay?.["pathChosen"]) ?? asString(summary?.["pathChosen"])
	const scopeSize = extractScopeSize(summary)
	const verificationProfile = extractVerificationProfile(summary)
	const guardrail = "Advisory only; replay-learned hints may not widen scope or override current task truth."

	if (!accepted) {
		return {
			eligible: false,
			source: "not_accepted",
			summary: "Run is not eligible for replay-learned reuse because it did not finish accepted.",
			pathChosen,
			scopeSize,
			verificationProfile,
			lessons: [],
			highlights: [],
			guardrail,
		}
	}

	const resolvedOverview = resolveReplayOverview(summary, replay)
	const highlights = asStringArray(resolvedOverview.overview?.["highlights"]).slice(0, 2)
	const coordinationSummary = asString(resolvedOverview.overview?.["coordinationSummary"])
	const reviewSummary = asString(resolvedOverview.overview?.["reviewSummary"])
	const artifactSummary = asString(resolvedOverview.overview?.["artifactSummary"])
	const lessons = [
		pathChosen
			? `Keep the ${pathChosen} lane shape when the next task has a comparable bounded scope${scopeSize > 0 ? ` (${scopeSize} file(s))` : ""}.`
			: scopeSize > 0
				? `Keep the next task bounded to about ${scopeSize} file(s) when reusing this accepted run.`
				: null,
		verificationProfile ? `Reuse verification profile ${verificationProfile} if the repo still supports it.` : null,
		coordinationSummary ? `Reuse only the bounded coordination shape already shown in replay: ${truncate(coordinationSummary)}.` : null,
		reviewSummary ? `Preserve the accepted review path recorded in replay: ${truncate(reviewSummary)}.` : null,
		highlights[0] ? `Start from replay highlight: ${truncate(highlights[0])}.` : null,
		artifactSummary?.includes("patternMemory=yes")
			? "Inspect the accepted replay and pattern-memory artifacts before widening the next attempt."
			: null,
	]
		.filter((value): value is string => Boolean(value))
		.slice(0, 4)

	const summaryText =
		resolvedOverview.source === "replay_artifact"
			? "Accepted bounded run captured as replay-backed advisory guidance."
			: resolvedOverview.source === "summary_replay_overview"
				? "Accepted bounded run captured from summary replay metadata for advisory guidance."
				: "Accepted bounded run captured from summary fallback metadata for advisory guidance."

	return {
		eligible: true,
		source: resolvedOverview.source,
		summary: summaryText,
		pathChosen,
		scopeSize,
		verificationProfile,
		lessons,
		highlights,
		guardrail,
	}
}

export function readReplayLearnedImprovementFromSummaryPath(summaryPath: string | null): ReplayLearnedImprovement | null {
	if (!summaryPath || !fs.existsSync(summaryPath)) return null

	let summary: Record<string, unknown> | null = null
	try {
		summary = asRecord(JSON.parse(fs.readFileSync(summaryPath, "utf8")))
	} catch {
		summary = null
	}
	if (!summary) return null

	let replay: Record<string, unknown> | null = null
	const replayArtifactPath = asString(summary["replayArtifactPath"])
	if (replayArtifactPath && fs.existsSync(replayArtifactPath)) {
		try {
			replay = asRecord(JSON.parse(fs.readFileSync(replayArtifactPath, "utf8")))
		} catch {
			replay = null
		}
	} else {
		const siblingReplayPath = path.join(path.dirname(summaryPath), "replay.json")
		if (fs.existsSync(siblingReplayPath)) {
			try {
				replay = asRecord(JSON.parse(fs.readFileSync(siblingReplayPath, "utf8")))
			} catch {
				replay = null
			}
		}
	}

	return buildReplayLearnedImprovement(summary, replay)
}
