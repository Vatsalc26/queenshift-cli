import type { AssignmentLedger } from "./AssignmentLedger"
import type { DependencyGraphArtifact } from "./DependencyGraph"
import { buildPlanningStageWindow, type PlanningContinuationSurface, type PlanningStageWindow } from "./PlanningHorizon"

export type CompletionState = "complete" | "blocked"
export type CompletionDependencyState = "ready" | "waiting" | "released"

export type CompletionLedgerEntry = {
	workItemId: string
	assignmentId: string
	assignmentToken: string
	runId: string
	state: CompletionState
	stage: number
	dependsOn: string[]
	dependencyState: CompletionDependencyState
	releasedWorkItems: string[]
	proofArtifactPath: string | null
	proofReason: string
}

export type CompletionLedger = {
	schemaVersion: 1
	proofBeforeDoneValid: boolean
	dependencyGraphSafe: boolean
	continuationSurface: PlanningContinuationSurface
	stageSummary: PlanningStageWindow
	entries: CompletionLedgerEntry[]
}

export type CompletionValidationResult = {
	valid: boolean
	issues: string[]
}

export function buildCompletionLedger(input: {
	runId: string
	finalStatus: "done" | "review_required" | "failed"
	assignments: AssignmentLedger | null
	proofArtifactPath: string
	dependencyGraph?: DependencyGraphArtifact | null
}): CompletionLedger | null {
	if (!input.assignments) return null
	const dependentsByWorkItemId = new Map<string, string[]>()
	for (const assignment of input.assignments.assignments) {
		for (const dependency of assignment.dependsOn) {
			const dependents = dependentsByWorkItemId.get(dependency) ?? []
			dependents.push(assignment.workItemId)
			dependentsByWorkItemId.set(dependency, dependents)
		}
	}

	const entries = input.assignments.assignments.map((assignment) => {
		const completed = input.finalStatus === "done"
		const releasedWorkItems = completed ? [...(dependentsByWorkItemId.get(assignment.workItemId) ?? [])] : []
		const dependencyState = completed
			? releasedWorkItems.length > 0
				? ("released" as const)
				: ("ready" as const)
			: assignment.dependsOn.length > 0
				? ("waiting" as const)
				: ("ready" as const)
		return {
			workItemId: assignment.workItemId,
			assignmentId: assignment.assignmentId,
			assignmentToken: assignment.assignmentToken,
			runId: input.runId,
			state: (completed ? "complete" : "blocked") as CompletionState,
			stage: Math.max(1, assignment.stage ?? 1),
			dependsOn: [...assignment.dependsOn],
			dependencyState,
			releasedWorkItems,
			proofArtifactPath: completed ? input.proofArtifactPath : null,
			proofReason: completed ? "Final summary reached done with this run's assignment token." : "Run ended before completion proof was available.",
		}
	})

	const validation = validateCompletionLedger(
		{
			schemaVersion: 1,
			proofBeforeDoneValid: true,
			dependencyGraphSafe: true,
			continuationSurface: new Set(entries.map((entry) => entry.stage)).size > 1 ? "retry_planner_checkpoint_artifacts" : "not_needed",
			stageSummary: buildPlanningStageWindow(entries),
			entries,
		},
		input.runId,
	)

	const stageSummary = buildPlanningStageWindow(entries)
	return {
		schemaVersion: 1,
		proofBeforeDoneValid: validation.valid,
		dependencyGraphSafe: validation.valid,
		continuationSurface: stageSummary.totalStages > 1 ? "retry_planner_checkpoint_artifacts" : "not_needed",
		stageSummary,
		entries,
	}
}

export function validateCompletionLedger(ledger: CompletionLedger, currentRunId: string): CompletionValidationResult {
	const issues: string[] = []
	const entriesByWorkItemId = new Map(ledger.entries.map((entry) => [entry.workItemId, entry]))
	for (const entry of ledger.entries) {
		if (!entry.assignmentId.trim()) issues.push("Completion entry is missing assignmentId.")
		if (!entry.assignmentToken.trim()) issues.push(`Completion entry ${entry.assignmentId} is missing assignmentToken.`)
		if (entry.runId !== currentRunId) issues.push(`Stale completion entry detected for ${entry.assignmentId}: ${entry.runId}`)
		if (entry.state === "complete" && !entry.proofArtifactPath) {
			issues.push(`Completion entry ${entry.assignmentId} is complete without a proof artifact path.`)
		}
		if (entry.state === "complete") {
			for (const dependency of entry.dependsOn) {
				if (entriesByWorkItemId.get(dependency)?.state !== "complete") {
					issues.push(`Completion entry ${entry.assignmentId} is complete before dependency ${dependency}.`)
				}
			}
		}
	}
	return {
		valid: issues.length === 0,
		issues,
	}
}

export function formatCompletionLedger(ledger: CompletionLedger | null): string {
	if (!ledger) return "Completion ledger: (none)"
	return [
		`Proof-before-done valid: ${ledger.proofBeforeDoneValid ? "yes" : "no"}`,
		`Dependency-graph safe: ${ledger.dependencyGraphSafe ? "yes" : "no"}`,
		`Continuation surface: ${ledger.continuationSurface}`,
		`Stage summary: active=${ledger.stageSummary.activeStage ?? "(none)"} next=${ledger.stageSummary.nextStage ?? "(none)"} completed=${ledger.stageSummary.completedStages.join(", ") || "(none)"} remaining=${ledger.stageSummary.remainingStages.join(", ") || "(none)"}`,
		"Completion entries:",
		...ledger.entries.map(
			(entry) =>
				`- ${entry.assignmentId} token=${entry.assignmentToken} stage=${entry.stage} state=${entry.state} dependencyState=${entry.dependencyState} dependsOn=${entry.dependsOn.join(", ") || "(none)"} released=${entry.releasedWorkItems.join(", ") || "(none)"} proof=${entry.proofArtifactPath ?? "(none)"}`,
		),
	].join("\n")
}
