import { formatQueenshiftWorkspaceCommand } from "./CommandSurface"

type SummaryLike = Record<string, unknown>

export type RuntimeVisibilitySnapshot = {
	engine: string | null
	pathChosen: string | null
	selectedSpecialist: string | null
	focusHeadline: string
	progressSummary: string
	recoveryLoop: string | null
	nextCommand: string | null
	summaryPath: string | null
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

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null
}

function buildProgressSummary(summary: SummaryLike | null): {
	pathChosen: string | null
	selectedSpecialist: string | null
	headline: string
	text: string
} {
	const pathChosen = asString(summary?.["pathChosen"])
	const fastLane = asRecord(summary?.["fastLane"])
	const progressMap = asRecord(summary?.["progressMap"])
	const stageSummary = asRecord(progressMap?.["stageSummary"])
	const queenbeeLive = asRecord(summary?.["queenbeeLive"])
	const verificationProfile = asRecord(summary?.["verificationProfile"])

	const selectedSpecialist = asString(queenbeeLive?.["selectedSpecialist"])
	const parts: string[] = []
	const focusParts: string[] = []

	if (pathChosen) parts.push(`path=${pathChosen}`)

	const laneId = asString(fastLane?.["laneId"])
	if (laneId) parts.push(`lane=${laneId}`)
	if (pathChosen && laneId) focusParts.push(`${pathChosen} on ${laneId}`)
	else if (pathChosen) focusParts.push(pathChosen)
	else if (laneId) focusParts.push(laneId)

	const stageCount = asNumber(progressMap?.["stageCount"])
	if (stageCount !== null) parts.push(`stages=${stageCount}`)

	const activeStage = asNumber(stageSummary?.["activeStage"])
	if (activeStage !== null) parts.push(`active_stage=${activeStage}`)

	const nextStage = asNumber(stageSummary?.["nextStage"])
	if (nextStage !== null) parts.push(`next_stage=${nextStage}`)
	if (activeStage !== null && stageCount !== null) focusParts.push(`stage ${activeStage} of ${stageCount}`)
	else if (stageCount !== null) focusParts.push(`${stageCount} stage${stageCount === 1 ? "" : "s"}`)

	const readyCount = asStringArray(progressMap?.["readyAssignmentIds"]).length
	const blockedCount = asStringArray(progressMap?.["blockedAssignmentIds"]).length
	const releasedCount = asStringArray(progressMap?.["releasedAssignmentIds"]).length
	if (readyCount > 0 || blockedCount > 0 || releasedCount > 0) {
		parts.push(`assignments=ready:${readyCount}/blocked:${blockedCount}/released:${releasedCount}`)
	}

	if (selectedSpecialist) parts.push(`specialist=${selectedSpecialist}`)
	if (selectedSpecialist) focusParts.push(`specialist ${selectedSpecialist}`)

	const verificationStatus = asString(verificationProfile?.["status"])
	if (verificationStatus && verificationStatus !== "not_applicable") parts.push(`verify=${verificationStatus}`)
	if (verificationStatus && verificationStatus !== "not_applicable") focusParts.push(`verification ${verificationStatus}`)

	return {
		pathChosen,
		selectedSpecialist,
		headline: focusParts.length > 0 ? focusParts.join(", ") : "No runtime progress summary recorded yet.",
		text: parts.length > 0 ? parts.join(" | ") : "no runtime progress summary recorded yet",
	}
}

export function formatQueenshiftRecoveryLoop(status: string): string | null {
	switch (status) {
		case "review_required":
			return "review:list -> owner:quick-actions -> replay:latest"
		case "failed":
			return "incident:latest -> owner:quick-actions -> replay:latest"
		default:
			return null
	}
}

function resolveNextCommand(workspace: string, status: string): string | null {
	switch (status) {
		case "done":
			return formatQueenshiftWorkspaceCommand(["replay:latest"], workspace)
		case "review_required":
			return formatQueenshiftWorkspaceCommand(["review:list"], workspace)
		case "failed":
			return formatQueenshiftWorkspaceCommand(["incident:latest"], workspace)
		default:
			return null
	}
}

export function buildRuntimeVisibilitySnapshot(
	summary: SummaryLike | null,
	workspace: string,
	status: string,
	summaryPath: string | null,
): RuntimeVisibilitySnapshot {
	const progress = buildProgressSummary(summary)
	return {
		engine: asString(summary?.["engine"]),
		pathChosen: progress.pathChosen,
		selectedSpecialist: progress.selectedSpecialist,
		focusHeadline: progress.headline,
		progressSummary: progress.text,
		recoveryLoop: formatQueenshiftRecoveryLoop(status),
		nextCommand: resolveNextCommand(workspace, status),
		summaryPath,
	}
}

export function formatRuntimeVisibilityBlock(snapshot: RuntimeVisibilitySnapshot): string {
	return [
		"Runtime summary:",
		`Engine: ${snapshot.engine ?? "(unknown)"}`,
		`Path: ${snapshot.pathChosen ?? "(unknown)"}`,
		`Current focus: ${snapshot.focusHeadline}`,
		`Visible progress: ${snapshot.progressSummary}`,
		...(snapshot.selectedSpecialist ? [`Selected specialist: ${snapshot.selectedSpecialist}`] : []),
		...(snapshot.recoveryLoop ? [`Recovery loop: ${snapshot.recoveryLoop}`] : []),
		`Summary artifact: ${snapshot.summaryPath ?? "(missing)"}`,
		`Next step: ${snapshot.nextCommand ?? "(none)"}`,
	].join("\n")
}
