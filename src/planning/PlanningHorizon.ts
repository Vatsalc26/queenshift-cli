export type PlanningHorizonMode = "single_pass" | "stage_gated"
export type PlanningContinuationSurface = "not_needed" | "retry_planner_checkpoint_artifacts"

export type PlanningHorizonArtifact = {
	schemaVersion: 1
	mode: PlanningHorizonMode
	totalStages: number
	checkpointStages: number[]
	replanTriggers: string[]
	stopCriteria: string[]
	continuationSurface: PlanningContinuationSurface
	summary: string
}

export type PlanningStageWindow = {
	totalStages: number
	activeStage: number | null
	completedStages: number[]
	remainingStages: number[]
	nextStage: number | null
	anchorWorkItems: string[]
	summary: string
}

function uniqueSortedNumbers(values: number[]): number[] {
	return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0))).sort((a, b) => a - b)
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

export function buildPlanningHorizonArtifact(
	workItems: Array<{ stage?: number | null; dependsOn?: string[] }>,
): PlanningHorizonArtifact {
	const stageNumbers = uniqueSortedNumbers(workItems.map((item) => Math.max(1, item.stage ?? 1)))
	const totalStages = stageNumbers.at(-1) ?? 1
	const mode: PlanningHorizonMode = totalStages > 1 ? "stage_gated" : "single_pass"
	return {
		schemaVersion: 1,
		mode,
		totalStages,
		checkpointStages: mode === "stage_gated" ? stageNumbers.slice(0, -1) : [],
		replanTriggers: uniqueStrings([
			"review_blocked",
			"critic_concern",
			mode === "stage_gated" ? "stage_completion" : "",
			workItems.some((item) => (item.dependsOn?.length ?? 0) > 0) ? "dependency_release" : "",
		]),
		stopCriteria: uniqueStrings([
			"fail_closed_on_scope_drift",
			"fail_closed_on_missing_dependency_reason",
			mode === "stage_gated" ? "pause_before_skipping_stage_gate" : "",
			mode === "stage_gated" ? "use_checkpoint_retry_artifacts_before_replan" : "",
		]),
		continuationSurface: mode === "stage_gated" ? "retry_planner_checkpoint_artifacts" : "not_needed",
		summary:
			mode === "stage_gated"
				? `${totalStages}-stage bounded plan with explicit stage gates and checkpoint-aware retry continuity.`
				: "Single-stage bounded plan; no separate campaign gate is needed.",
	}
}

export function buildPlanningStageWindow(
	entries: Array<{ stage: number; state: string; workItemId: string }>,
): PlanningStageWindow {
	const stageNumbers = uniqueSortedNumbers(entries.map((entry) => Math.max(1, entry.stage)))
	const completedStages = stageNumbers.filter((stage) =>
		entries.filter((entry) => entry.stage === stage).every((entry) => entry.state === "complete"),
	)
	const remainingStages = stageNumbers.filter((stage) => !completedStages.includes(stage))
	const activeStage = remainingStages.length > 0 ? remainingStages[0] ?? null : null
	const nextStage = activeStage === null ? null : remainingStages.find((stage) => stage > activeStage) ?? null
	const anchorWorkItems =
		activeStage === null
			? []
			: entries.filter((entry) => entry.stage === activeStage && entry.state !== "complete").map((entry) => entry.workItemId)
	return {
		totalStages: stageNumbers.at(-1) ?? 1,
		activeStage,
		completedStages,
		remainingStages,
		nextStage,
		anchorWorkItems,
		summary:
			activeStage === null
				? `All ${stageNumbers.at(-1) ?? 1} stage(s) complete.`
				: `Stage ${activeStage} is active; next stage ${nextStage ?? "(none)"}.`,
	}
}
