import type { Complexity, RoutingDecision, RoutingPath, RoutingSource } from "../agents/CoordinatorAgent"

export type ModeCostTier = "low" | "medium" | "high"
export type ModeSteeringTier = "low" | "medium" | "high"
export type ModeId =
	| "low_cost_small_lane"
	| "balanced_simple_lane"
	| "balanced_scoped_lane"
	| "balanced_semi_open_lane"
	| "high_context_medium_lane"
	| "heavy_complex_lane"
export type FastLaneId = "simple_task_fast_lane"

export type ModeSelectorDecision = {
	schemaVersion: 1
	modeId: ModeId
	routingPath: RoutingPath
	complexity: Complexity
	selectorSource: RoutingSource
	costTier: ModeCostTier
	steeringTier: ModeSteeringTier
	maxModelCalls: number
	maxEstimatedTokens: number
	targetFileCount: number
	reasonCodes: string[]
	summary: string
}

export type FastLaneDecision = {
	schemaVersion: 1
	laneId: FastLaneId
	modeId: "low_cost_small_lane"
	routingPath: "small_task"
	predictability: "high"
	targetFileCount: number
	expectedWorkItems: 1
	expectedBuilderCount: 1
	mergeMode: "not_applicable"
	reviewMode: "single_file_bounded"
	summary: string
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function describeMode(routing: RoutingDecision): {
	modeId: ModeId
	costTier: ModeCostTier
	steeringTier: ModeSteeringTier
	summary: string
} {
	switch (routing.path) {
		case "small_task":
			return {
				modeId: "low_cost_small_lane",
				costTier: "low",
				steeringTier: "low",
				summary: "Safe single-file work stays on the cheapest bounded lane instead of escalating into heavier coordination.",
			}
		case "simple":
			return {
				modeId: "balanced_simple_lane",
				costTier: "low",
				steeringTier: "medium",
				summary: "Classifier-marked simple work stays lightweight, but keeps a little extra steering budget because the task was ambiguous.",
			}
		case "scoped":
			return {
				modeId: "balanced_scoped_lane",
				costTier: "medium",
				steeringTier: "medium",
				summary: "Explicit 2-5 file work uses bounded coordination without paying for the heaviest swarm mode.",
			}
		case "semi_open":
			return {
				modeId: "balanced_semi_open_lane",
				costTier: "medium",
				steeringTier: "medium",
				summary: "Semi-open anchored work gets bounded discovery plus a middle-cost coordination budget.",
			}
		case "medium":
			return {
				modeId: "high_context_medium_lane",
				costTier: "high",
				steeringTier: "high",
				summary:
					"6-10 file bounded work keeps explicit review bias and high-context coordination, but on a dedicated ceiling below the full complex lane.",
			}
		case "complex":
		default:
			return {
				modeId: "heavy_complex_lane",
				costTier: "high",
				steeringTier: "high",
				summary: "The task stays on the full complex lane because cheaper bounded ceilings were not justified.",
			}
	}
}

export function buildModeSelectorDecision(input: {
	routing: RoutingDecision
	guardrailLimits: { maxModelCalls: number; maxEstimatedTokens: number }
}): ModeSelectorDecision {
	const described = describeMode(input.routing)
	return {
		schemaVersion: 1,
		modeId: described.modeId,
		routingPath: input.routing.path,
		complexity: input.routing.complexity,
		selectorSource: input.routing.selectorSource,
		costTier: described.costTier,
		steeringTier: described.steeringTier,
		maxModelCalls: input.guardrailLimits.maxModelCalls,
		maxEstimatedTokens: input.guardrailLimits.maxEstimatedTokens,
		targetFileCount: input.routing.targetFiles.length,
		reasonCodes: uniqueStrings([
			...input.routing.reasonCodes,
			described.costTier === "low"
				? "guardrail_budget_low"
				: described.costTier === "medium"
					? "guardrail_budget_medium"
					: "guardrail_budget_high",
		]),
		summary: described.summary,
	}
}

export function formatModeSelectorDecision(decision: ModeSelectorDecision): string {
	return `${decision.modeId} path=${decision.routingPath} cost=${decision.costTier} steering=${decision.steeringTier} budget=${decision.maxModelCalls} calls/${decision.maxEstimatedTokens} tokens source=${decision.selectorSource}`
}

export function buildFastLaneDecision(decision: ModeSelectorDecision | null): FastLaneDecision | null {
	if (!decision || decision.modeId !== "low_cost_small_lane" || decision.routingPath !== "small_task") return null
	return {
		schemaVersion: 1,
		laneId: "simple_task_fast_lane",
		modeId: "low_cost_small_lane",
		routingPath: "small_task",
		predictability: "high",
		targetFileCount: decision.targetFileCount,
		expectedWorkItems: 1,
		expectedBuilderCount: 1,
		mergeMode: "not_applicable",
		reviewMode: "single_file_bounded",
		summary: "Tiny explicit single-file work stays on one predictable owner lane instead of paying for extra coordination.",
	}
}

export function formatFastLaneDecision(decision: FastLaneDecision): string {
	return `${decision.laneId} predictable=${decision.predictability} workItems=${decision.expectedWorkItems} builders=${decision.expectedBuilderCount} merge=${decision.mergeMode}`
}
