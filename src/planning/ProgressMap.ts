import type { RunEvent } from "../run/RunArtifacts"
import type { AssignmentLedger } from "./AssignmentLedger"
import type { CompletionLedger } from "./CompletionLedger"
import type { DependencyGraphArtifact } from "./DependencyGraph"
import { buildPlanningStageWindow, type PlanningStageWindow } from "./PlanningHorizon"

export type ProgressState = "planned" | "assigned" | "in_progress" | "blocked" | "complete" | "skipped"
export type ProgressDependencyState = "ready" | "waiting" | "released"

export type ProgressEntry = {
	workItemId: string
	assignmentId: string
	state: ProgressState
	history: ProgressState[]
	reason: string
	stage: number
	dependsOn: string[]
	waitingOn: string[]
	dependencyState: ProgressDependencyState
	releasedWorkItems: string[]
}

export type ProgressMap = {
	schemaVersion: 1
	readyAssignmentIds: string[]
	blockedAssignmentIds: string[]
	releasedAssignmentIds: string[]
	stageCount: number
	stageSummary: PlanningStageWindow
	entries: ProgressEntry[]
}

function eventString(event: RunEvent, key: string): string | null {
	const value = event[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function buildProgressMap(input: {
	assignments: AssignmentLedger | null
	completionLedger: CompletionLedger | null
	events: RunEvent[]
	dependencyGraph?: DependencyGraphArtifact | null
}): ProgressMap | null {
	if (!input.assignments) return null
	const assignments = input.assignments
	const completionByAssignmentId = new Map(
		(input.completionLedger?.entries ?? []).map((entry) => [entry.assignmentId, entry]),
	)
	const completionByWorkItemId = new Map(
		(input.completionLedger?.entries ?? []).map((entry) => [entry.workItemId, entry]),
	)

	const entries = assignments.assignments.map((assignment) => {
		const history: ProgressState[] = ["planned", "assigned"]
		const waitingOn = assignment.dependsOn.filter((dependency) => completionByWorkItemId.get(dependency)?.state !== "complete")
		const releasedWorkItems =
			completionByAssignmentId.get(assignment.assignmentId)?.releasedWorkItems ??
			assignments.assignments.filter((entry) => entry.dependsOn.includes(assignment.workItemId)).map((entry) => entry.workItemId)
		if (waitingOn.length > 0) {
			history.push("blocked")
			return {
				workItemId: assignment.workItemId,
				assignmentId: assignment.assignmentId,
				state: "blocked" as const,
				history,
				reason: `Waiting on dependency completion: ${waitingOn.join(", ")}.`,
				stage: assignment.stage ?? 1,
				dependsOn: [...assignment.dependsOn],
				waitingOn,
				dependencyState: "waiting" as const,
				releasedWorkItems: [],
			}
		}
		const sawBuilderWork = input.events.some((event) => {
			const eventType = eventString(event, "type")
			const agentId = eventString(event, "agentId")
			return (
				(eventType === "agent_start" || eventType === "agent_iteration") &&
				agentId === assignment.assignedBuilder
			)
		})
		if (sawBuilderWork) history.push("in_progress")

		const completion = completionByAssignmentId.get(assignment.assignmentId)
		if (completion?.state === "complete") {
			history.push("complete")
			return {
				workItemId: assignment.workItemId,
				assignmentId: assignment.assignmentId,
				state: "complete" as const,
				history,
				reason: "Matching assignment token has completion proof.",
				stage: assignment.stage ?? 1,
				dependsOn: [...assignment.dependsOn],
				waitingOn: [],
				dependencyState: releasedWorkItems.length > 0 ? ("released" as const) : ("ready" as const),
				releasedWorkItems,
			}
		}

		if (completion?.state === "blocked") {
			history.push("blocked")
			return {
				workItemId: assignment.workItemId,
				assignmentId: assignment.assignmentId,
				state: "blocked" as const,
				history,
				reason: "Run ended without completion proof for this assignment.",
				stage: assignment.stage ?? 1,
				dependsOn: [...assignment.dependsOn],
				waitingOn: [],
				dependencyState: "ready" as const,
				releasedWorkItems: [],
			}
		}

		return {
			workItemId: assignment.workItemId,
			assignmentId: assignment.assignmentId,
			state: sawBuilderWork ? ("in_progress" as const) : ("assigned" as const),
			history,
			reason: sawBuilderWork ? "Builder activity was recorded for this assignment." : "Assignment exists but no progress event has been recorded yet.",
			stage: assignment.stage ?? 1,
			dependsOn: [...assignment.dependsOn],
			waitingOn: [],
			dependencyState: "ready" as const,
			releasedWorkItems: [],
		}
	})

	return {
		schemaVersion: 1,
		readyAssignmentIds: entries.filter((entry) => entry.dependencyState !== "waiting").map((entry) => entry.assignmentId),
		blockedAssignmentIds: entries.filter((entry) => entry.state === "blocked").map((entry) => entry.assignmentId),
		releasedAssignmentIds: entries.filter((entry) => entry.dependencyState === "released").map((entry) => entry.assignmentId),
		stageCount: input.dependencyGraph?.stageCount ?? new Set(entries.map((entry) => entry.stage)).size,
		stageSummary: buildPlanningStageWindow(entries),
		entries,
	}
}

export function formatProgressMap(progressMap: ProgressMap | null): string {
	if (!progressMap) return "Progress map: (none)"
	return [
		`Summary: ready=${progressMap.readyAssignmentIds.join(", ") || "(none)"} blocked=${progressMap.blockedAssignmentIds.join(", ") || "(none)"} released=${progressMap.releasedAssignmentIds.join(", ") || "(none)"} stages=${progressMap.stageCount}`,
		`Stage summary: active=${progressMap.stageSummary.activeStage ?? "(none)"} next=${progressMap.stageSummary.nextStage ?? "(none)"} completed=${progressMap.stageSummary.completedStages.join(", ") || "(none)"} anchors=${progressMap.stageSummary.anchorWorkItems.join(", ") || "(none)"}`,
		"Progress entries:",
		...progressMap.entries.map(
			(entry) =>
				`- ${entry.assignmentId} stage=${entry.stage} state=${entry.state} dependencyState=${entry.dependencyState} dependsOn=${entry.dependsOn.join(", ") || "(none)"} waitingOn=${entry.waitingOn.join(", ") || "(none)"} released=${entry.releasedWorkItems.join(", ") || "(none)"} history=${entry.history.join(" -> ")} reason=${entry.reason}`,
		),
	].join("\n")
}
