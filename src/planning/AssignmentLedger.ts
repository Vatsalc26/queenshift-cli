import type { Subtask } from "../agents/SupervisorAgent"
import type { SwarmPlanArtifact } from "./PlanSchema"
import type { WorkerSpecializationId } from "./RoleManuals"
import type { SupervisorArbitrationSummary } from "./SupervisorArbitration"
import { findTeamShapeBuilderProfile } from "./TeamShape"

export type AssignmentStatus = "assigned" | "blocked" | "complete"

export type AssignmentEntry = {
	workItemId: string
	assignmentId: string
	assignmentToken: string
	assignedBuilder: string
	ownedFiles: string[]
	dependsOn: string[]
	status: "assigned"
	blockers: string[]
	stage?: number
	ownershipRule?: string | null
	dependencyReason?: string | null
	specializationId?: WorkerSpecializationId | null
	specializationLabel?: string | null
}

export type AssignmentLedger = {
	schemaVersion: 1
	handoffValid: boolean
	handoffIssues: string[]
	arbitration?: SupervisorArbitrationSummary
	assignments: AssignmentEntry[]
}

export type AssignmentValidationResult = {
	valid: boolean
	issues: string[]
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)))
}

function detectDependencyCycles(assignments: AssignmentEntry[]): string[] {
	const issues: string[] = []
	const byId = new Map(assignments.map((entry) => [entry.workItemId, entry]))
	const visiting = new Set<string>()
	const visited = new Set<string>()

	const walk = (workItemId: string) => {
		if (visited.has(workItemId)) return
		if (visiting.has(workItemId)) {
			issues.push(`Dependency cycle detected at ${workItemId}.`)
			return
		}
		visiting.add(workItemId)
		const entry = byId.get(workItemId)
		for (const dependency of entry?.dependsOn ?? []) {
			if (!byId.has(dependency)) {
				issues.push(`Assignment ${workItemId} depends on missing work item ${dependency}.`)
				continue
			}
			walk(dependency)
		}
		visiting.delete(workItemId)
		visited.add(workItemId)
	}

	for (const entry of assignments) walk(entry.workItemId)
	return issues
}

export function buildAssignmentLedger(plan: SwarmPlanArtifact, subtasks: Subtask[]): AssignmentLedger {
	const subtaskById = new Map(subtasks.map((subtask) => [subtask.id, subtask]))
	const assignments: AssignmentEntry[] = plan.workItems.map((item, index) => {
		const matchedSubtask = subtaskById.get(item.id)
		const assignedBuilder = matchedSubtask?.assignedBuilder ?? item.assignmentHint
		const builderProfile = findTeamShapeBuilderProfile(plan.teamShape, item.id, assignedBuilder)
		return {
			workItemId: item.id,
			assignmentId: `assign-${item.id}`,
			assignmentToken: `${assignedBuilder}:${item.id}:${index + 1}`,
			assignedBuilder,
			ownedFiles: uniqueStrings(matchedSubtask?.files ?? item.files),
			dependsOn: [...item.dependsOn],
			status: "assigned",
			blockers: [],
			stage: Math.max(1, item.stage ?? 1),
			ownershipRule: item.ownershipRule ?? null,
			dependencyReason: item.dependencyReason ?? null,
			specializationId: builderProfile?.specializationId ?? null,
			specializationLabel: builderProfile?.label ?? null,
		}
	})

	const issues: string[] = []
	if (plan.planStatus === "planned" && plan.scoutCoverage.coveredFiles.length === 0) {
		issues.push("Scout coverage is empty for a planned complex assignment ledger.")
	}

	const coveredByAssignments = new Set(assignments.flatMap((entry) => entry.ownedFiles))
	for (const file of plan.scoutCoverage.coveredFiles) {
		if (!coveredByAssignments.has(file)) issues.push(`Scout-covered file is missing from assignments: ${file}`)
	}

	const fileOwners = new Map<string, string>()
	for (const entry of assignments) {
		for (const file of entry.ownedFiles) {
			const existingOwner = fileOwners.get(file)
			if (existingOwner && existingOwner !== entry.workItemId) {
				issues.push(`File ownership overlaps without an explicit dependency rule: ${file}`)
			}
			fileOwners.set(file, entry.workItemId)
		}
	}

	issues.push(...detectDependencyCycles(assignments))
	if (assignments.length !== plan.arbitration.activeBuilderCount) {
		issues.push(`Assignment count ${assignments.length} does not match arbitration activeBuilderCount ${plan.arbitration.activeBuilderCount}.`)
	}
	if (plan.arbitration.delegationMode === "single_owner" && assignments.length > 1) {
		issues.push("Single-owner delegation cannot hand off to multiple assignments.")
	}
	if (plan.arbitration.clarificationMode === "disabled" && assignments.length > 1) {
		issues.push("Clarification mode cannot be disabled when multiple assignment owners exist.")
	}
	if (plan.arbitration.dependencyMode === "serial" && plan.arbitration.clarificationMode === "dependency_and_same_stage_routes") {
		issues.push("Serial delegation must not expose same-stage clarification routes.")
	}
	if (plan.teamShape && assignments.some((entry) => !entry.specializationId?.trim())) {
		issues.push("Team-shape builder specialization is missing from at least one assignment.")
	}
	for (const entry of assignments) {
		if (entry.dependsOn.length > 0 && !entry.dependencyReason) {
			issues.push(`Assignment ${entry.assignmentId} has dependencies but no dependencyReason.`)
		}
	}

	return {
		schemaVersion: 1,
		handoffValid: issues.length === 0,
		handoffIssues: issues,
		arbitration: plan.arbitration,
		assignments,
	}
}

export function validateAssignmentLedger(ledger: AssignmentLedger): AssignmentValidationResult {
	const issues = [...ledger.handoffIssues]
	const seenAssignmentIds = new Set<string>()
	const seenTokens = new Set<string>()

	for (const entry of ledger.assignments) {
		if (!entry.workItemId.trim()) issues.push("Assignment is missing workItemId.")
		if (!entry.assignmentId.trim()) issues.push("Assignment is missing assignmentId.")
		if (seenAssignmentIds.has(entry.assignmentId)) issues.push(`Duplicate assignmentId: ${entry.assignmentId}`)
		if (seenTokens.has(entry.assignmentToken)) issues.push(`Duplicate assignmentToken: ${entry.assignmentToken}`)
		seenAssignmentIds.add(entry.assignmentId)
		seenTokens.add(entry.assignmentToken)
		if (entry.ownedFiles.length === 0) issues.push(`Assignment ${entry.assignmentId} owns no files or boundaries.`)
		if (entry.dependsOn.length > 0 && !entry.dependencyReason) issues.push(`Assignment ${entry.assignmentId} is missing dependencyReason.`)
		if (entry.specializationLabel && !entry.specializationId) {
			issues.push(`Assignment ${entry.assignmentId} has a specialization label without a specialization id.`)
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	}
}

export function formatAssignmentLedger(ledger: AssignmentLedger): string {
	return [
		`Handoff valid: ${ledger.handoffValid ? "yes" : "no"}`,
		`Arbitration: ${
			ledger.arbitration
				? `strategy=${ledger.arbitration.strategy} active=${ledger.arbitration.activeBuilderCount}/${ledger.arbitration.requestedBuilderCount} dependencyMode=${ledger.arbitration.dependencyMode} delegation=${ledger.arbitration.delegationMode} clarification=${ledger.arbitration.clarificationMode} completion=${ledger.arbitration.completionRule}`
				: "(not recorded)"
		}`,
		...(ledger.handoffIssues.length > 0 ? ["Handoff issues:", ...ledger.handoffIssues.map((issue) => `- ${issue}`)] : []),
		"Assignments:",
		...ledger.assignments.map(
			(entry) =>
				`- ${entry.assignmentId} (${entry.assignmentToken}) -> ${entry.assignedBuilder} stage=${entry.stage} specialization=${entry.specializationId ?? "(none)"} owns ${entry.ownedFiles.join(", ")} dependsOn=${entry.dependsOn.join(", ") || "(none)"} status=${entry.status}`,
		),
	].join("\n")
}
