import type { AssignmentLedger } from "./AssignmentLedger"
import type { SwarmPlanArtifact } from "./PlanSchema"

export type MergeOrderStatus = "not_applicable" | "planned" | "blocked"
export type MergeNegotiationMode = "not_applicable" | "integration_branch_review" | "manual_conflict_review"
export type MergeNegotiationReadiness = "not_applicable" | "ready_for_review" | "blocked"
export type MergeReviewStageId = "source_order" | "integration_branch" | "human_approval"
export type MergeReviewStageStatus = "not_applicable" | "ready" | "blocked"

export type MergeOrderEntry = {
	workItemId: string
	assignmentId: string
	branchName: string
	order: number
	dependsOn: string[]
	reason: string
	ownedFiles: string[]
}

export type MergeNegotiationStep = {
	order: number
	workItemId: string
	assignmentId: string
	sourceBranch: string
	targetBranch: string
	dependsOnBranches: string[]
	reviewFocus: string[]
}

export type MergeReviewStage = {
	id: MergeReviewStageId
	label: string
	status: MergeReviewStageStatus
	summary: string
}

export type MergeNegotiationArtifact = {
	mode: MergeNegotiationMode
	readiness: MergeNegotiationReadiness
	targetBranch: string | null
	approvalBranch: string | null
	sourceBranches: string[]
	steps: MergeNegotiationStep[]
	reviewStages: MergeReviewStage[]
	reviewChecklist: string[]
	conflictReview: string[]
	handoffSummary: string
	summary: string
}

export type MergeOrderArtifact = {
	schemaVersion: 1
	status: MergeOrderStatus
	sequence: MergeOrderEntry[]
	conflictRisks: string[]
	blockers: string[]
	negotiation: MergeNegotiationArtifact
	summary: string
}

function hasExplicitOrdering(left: string, right: string, dependencies: Map<string, Set<string>>): boolean {
	return dependencies.get(left)?.has(right) === true || dependencies.get(right)?.has(left) === true
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function buildConflictReview(sequence: MergeOrderEntry[], conflictRisks: string[], blockers: string[]): string[] {
	const dependencyChecks = sequence
		.filter((entry) => entry.dependsOn.length > 0)
		.map((entry) => `Confirm ${entry.branchName} only lands after ${entry.dependsOn.join(", ")}.`)
	return Array.from(new Set([...conflictRisks, ...dependencyChecks, ...blockers]))
}

function summarizeHandoff(sequence: MergeOrderEntry[]): string {
	if (sequence.length === 0) return "No branch handoff is recorded."
	const handoffs = sequence.map((entry) => {
		const focus = entry.ownedFiles.length > 0 ? entry.ownedFiles.join(", ") : entry.reason
		return `${entry.branchName}${entry.dependsOn.length > 0 ? ` after ${entry.dependsOn.join(", ")}` : ""} (${focus})`
	})
	return `Ordered handoff: ${handoffs.join(" -> ")}.`
}

function buildReviewStages(
	status: MergeOrderStatus,
	integrationBranch: string,
	orderedBranches: string[],
	conflictReview: string[],
): MergeReviewStage[] {
	if (status === "not_applicable") {
		return []
	}
	if (status === "blocked") {
		return [
			{
				id: "source_order",
				label: "Source order",
				status: "blocked",
				summary: "Dependency-safe source ordering is not yet safe enough for approval.",
			},
			{
				id: "integration_branch",
				label: "Integration branch",
				status: "blocked",
				summary: `Do not trust ${integrationBranch} until the merge blockers are resolved.`,
			},
			{
				id: "human_approval",
				label: "Human approval",
				status: "blocked",
				summary: "Human approval must stop until merge blockers are cleared.",
			},
		]
	}
	return [
		{
			id: "source_order",
			label: "Source order",
			status: "ready",
			summary:
				orderedBranches.length > 1
					? `Review the ordered source branches: ${orderedBranches.join(" -> ")}.`
					: `Review the single source branch ${orderedBranches[0] ?? "(none)"}.`,
		},
		{
			id: "integration_branch",
			label: "Integration branch",
			status: "ready",
			summary: `Inspect ${integrationBranch} as the only approval candidate for this coordinated run.`,
		},
		{
			id: "human_approval",
			label: "Human approval",
			status: "ready",
			summary:
				conflictReview.length > 0
					? "Approval is ready only after the recorded conflict-review items have been checked."
					: "Approval can proceed once the recorded branch order and review focus still match the artifact.",
		},
	]
}

function buildMergeNegotiationArtifact(
	taskId: string,
	status: MergeOrderStatus,
	sequence: MergeOrderEntry[],
	conflictRisks: string[],
	blockers: string[],
): MergeNegotiationArtifact {
	const integrationBranch = `swarm/${taskId}/integration`
	if (status === "not_applicable") {
		return {
			mode: "not_applicable",
			readiness: "not_applicable",
			targetBranch: null,
			approvalBranch: null,
			sourceBranches: [],
			steps: [],
			reviewStages: [],
			reviewChecklist: [],
			conflictReview: [],
			handoffSummary: "No merge handoff is recorded for this run.",
			summary: "Merge negotiation is not applicable outside the bounded complex lane.",
		}
	}

	const steps = sequence.map((entry, index, all) => {
		const previousBranch = index > 0 ? all[index - 1]?.branchName ?? null : null
		const reviewFocus = entry.ownedFiles.length > 0 ? [...entry.ownedFiles] : [entry.reason]
		return {
			order: entry.order,
			workItemId: entry.workItemId,
			assignmentId: entry.assignmentId,
			sourceBranch: entry.branchName,
			targetBranch: integrationBranch,
			dependsOnBranches: entry.dependsOn
				.map((dependency) => all.find((candidate) => candidate.workItemId === dependency)?.branchName ?? null)
				.filter((branch): branch is string => typeof branch === "string" && branch.length > 0),
			reviewFocus: previousBranch ? [...reviewFocus, `handoff:${previousBranch}`] : reviewFocus,
		} satisfies MergeNegotiationStep
	})
	const conflictReview = buildConflictReview(sequence, conflictRisks, blockers)
	const orderedBranches = sequence.map((entry) => entry.branchName)
	const reviewStages = buildReviewStages(status, integrationBranch, orderedBranches, conflictReview)
	const handoffSummary = summarizeHandoff(sequence)

	if (status === "blocked") {
		return {
			mode: "manual_conflict_review",
			readiness: "blocked",
			targetBranch: integrationBranch,
			approvalBranch: integrationBranch,
			sourceBranches: orderedBranches,
			steps,
			reviewStages,
			reviewChecklist: [
				"Do not approve this run until merge blockers are resolved.",
				"Discard or rerun with narrower ownership or explicit dependency ordering.",
			],
			conflictReview,
			handoffSummary,
			summary: "Merge negotiation is blocked. Human review can inspect the evidence but should not approve this run.",
		}
	}

	const reviewChecklist = [
		`Review the integration branch ${integrationBranch} before approval.`,
		orderedBranches.length > 1
			? `Confirm the source branches landed in order: ${orderedBranches.join(" -> ")}.`
			: `Confirm the only source branch ${orderedBranches[0] ?? "(none)"} landed cleanly.`,
		"Approve only if the recorded branch set and merge order still match this artifact.",
	]
	if (conflictReview.length > 0) {
		reviewChecklist.push("Inspect every recorded conflict-review item before merging into the main workspace.")
	}

	return {
		mode: "integration_branch_review",
		readiness: "ready_for_review",
		targetBranch: integrationBranch,
		approvalBranch: integrationBranch,
		sourceBranches: orderedBranches,
		steps,
		reviewStages,
		reviewChecklist,
		conflictReview,
		handoffSummary,
		summary: `Integration branch ${integrationBranch} should absorb ${orderedBranches.length} source branch(es) before human approval.`,
	}
}

export function normalizeMergeOrderArtifact(taskId: string, value: unknown): MergeOrderArtifact | null {
	const record = asRecord(value)
	if (!record) return null
	const statusRaw = asString(record["status"], "not_applicable")
	const status: MergeOrderStatus =
		statusRaw === "planned" || statusRaw === "blocked" || statusRaw === "not_applicable" ? statusRaw : "not_applicable"
	const sequence = Array.isArray(record["sequence"])
		? record["sequence"]
				.map((item) => {
					const entry = asRecord(item)
					if (!entry) return null
					return {
						workItemId: asString(entry["workItemId"]),
						assignmentId: asString(entry["assignmentId"]),
						branchName: asString(entry["branchName"]),
						order: typeof entry["order"] === "number" && Number.isFinite(entry["order"]) ? entry["order"] : 0,
						dependsOn: asStringArray(entry["dependsOn"]),
						reason: asString(entry["reason"]),
						ownedFiles: asStringArray(entry["ownedFiles"]),
					} satisfies MergeOrderEntry
				})
				.filter((entry): entry is MergeOrderEntry => entry !== null && entry.workItemId.length > 0 && entry.assignmentId.length > 0)
		: []
	const conflictRisks = asStringArray(record["conflictRisks"])
	const blockers = asStringArray(record["blockers"])
	const fallbackNegotiation = buildMergeNegotiationArtifact(taskId, status, sequence, conflictRisks, blockers)
	const negotiationRecord = asRecord(record["negotiation"])
	const negotiationSteps = Array.isArray(negotiationRecord?.["steps"])
		? negotiationRecord?.["steps"]
				.map((item) => {
					const step = asRecord(item)
					if (!step) return null
					return {
						order: typeof step["order"] === "number" && Number.isFinite(step["order"]) ? step["order"] : 0,
						workItemId: asString(step["workItemId"]),
						assignmentId: asString(step["assignmentId"]),
						sourceBranch: asString(step["sourceBranch"]),
						targetBranch: asString(step["targetBranch"]),
						dependsOnBranches: asStringArray(step["dependsOnBranches"]),
						reviewFocus: asStringArray(step["reviewFocus"]),
					} satisfies MergeNegotiationStep
				})
				.filter((step): step is MergeNegotiationStep => step !== null && step.sourceBranch.length > 0)
		: fallbackNegotiation.steps
	const negotiationStages = Array.isArray(negotiationRecord?.["reviewStages"])
		? negotiationRecord["reviewStages"]
				.map((item) => {
					const stage = asRecord(item)
					if (!stage) return null
					const idRaw = asString(stage["id"])
					const statusRaw = asString(stage["status"])
					const id: MergeReviewStageId =
						idRaw === "source_order" || idRaw === "integration_branch" || idRaw === "human_approval"
							? idRaw
							: "integration_branch"
					const stageStatus: MergeReviewStageStatus =
						statusRaw === "ready" || statusRaw === "blocked" || statusRaw === "not_applicable" ? statusRaw : "ready"
					return {
						id,
						label: asString(stage["label"]) || id.replace(/_/g, " "),
						status: stageStatus,
						summary: asString(stage["summary"]),
					} satisfies MergeReviewStage
				})
				.filter((stage): stage is MergeReviewStage => stage !== null && stage.summary.length > 0)
		: fallbackNegotiation.reviewStages
	const modeRaw = asString(negotiationRecord?.["mode"], fallbackNegotiation.mode)
	const mode: MergeNegotiationMode =
		modeRaw === "integration_branch_review" || modeRaw === "manual_conflict_review" || modeRaw === "not_applicable"
			? modeRaw
			: fallbackNegotiation.mode
	const readinessRaw = asString(negotiationRecord?.["readiness"], fallbackNegotiation.readiness)
	const readiness: MergeNegotiationReadiness =
		readinessRaw === "ready_for_review" || readinessRaw === "blocked" || readinessRaw === "not_applicable"
			? readinessRaw
			: fallbackNegotiation.readiness

	return {
		schemaVersion: 1,
		status,
		sequence,
		conflictRisks,
		blockers,
		negotiation: {
			mode,
			readiness,
			targetBranch: asString(negotiationRecord?.["targetBranch"]) || fallbackNegotiation.targetBranch,
			approvalBranch: asString(negotiationRecord?.["approvalBranch"]) || fallbackNegotiation.approvalBranch,
			sourceBranches: asStringArray(negotiationRecord?.["sourceBranches"]).length > 0 ? asStringArray(negotiationRecord?.["sourceBranches"]) : fallbackNegotiation.sourceBranches,
			steps: negotiationSteps,
			reviewStages: negotiationStages.length > 0 ? negotiationStages : fallbackNegotiation.reviewStages,
			reviewChecklist:
				asStringArray(negotiationRecord?.["reviewChecklist"]).length > 0
					? asStringArray(negotiationRecord?.["reviewChecklist"])
					: fallbackNegotiation.reviewChecklist,
			conflictReview:
				asStringArray(negotiationRecord?.["conflictReview"]).length > 0
					? asStringArray(negotiationRecord?.["conflictReview"])
					: fallbackNegotiation.conflictReview,
			handoffSummary: asString(negotiationRecord?.["handoffSummary"]) || fallbackNegotiation.handoffSummary,
			summary: asString(negotiationRecord?.["summary"]) || fallbackNegotiation.summary,
		},
		summary: asString(record["summary"]) || fallbackNegotiation.summary,
	}
}

export function buildMergeOrderArtifact(input: {
	taskId: string
	plan: SwarmPlanArtifact | null
	assignments: AssignmentLedger | null
}): MergeOrderArtifact {
	if (!input.plan || !input.assignments) {
		return {
			schemaVersion: 1,
			status: "not_applicable",
			sequence: [],
			conflictRisks: [],
			blockers: [],
			negotiation: buildMergeNegotiationArtifact(input.taskId, "not_applicable", [], [], []),
			summary: "Merge order is not applicable outside the bounded complex lane.",
		}
	}

	const blockers = [...input.assignments.handoffIssues]
	const conflictRisks: string[] = []
	const dependencies = new Map<string, Set<string>>()
	const entries = input.assignments.assignments.map((assignment) => ({
		workItemId: assignment.workItemId,
		assignmentId: assignment.assignmentId,
		branchName: `swarm/${input.taskId}/${assignment.workItemId}`,
		dependsOn: [...assignment.dependsOn],
		ownedFiles: [...assignment.ownedFiles],
	}))

	for (const entry of entries) {
		dependencies.set(entry.workItemId, new Set(entry.dependsOn))
	}

	const ownersByFile = new Map<string, string[]>()
	for (const entry of entries) {
		for (const file of entry.ownedFiles) {
			const owners = ownersByFile.get(file) ?? []
			owners.push(entry.workItemId)
			ownersByFile.set(file, owners)
		}
	}

	for (const [file, owners] of ownersByFile.entries()) {
		const uniqueOwners = Array.from(new Set(owners))
		if (uniqueOwners.length <= 1) continue
		const ordered = uniqueOwners.every((owner, index) => index === 0 || hasExplicitOrdering(owner, uniqueOwners[index - 1] ?? "", dependencies))
		if (!ordered) {
			blockers.push(`Shared file ownership requires explicit dependency order: ${file}`)
			continue
		}
		conflictRisks.push(`Shared file ${file} is merge-ordered serially across ${uniqueOwners.join(", ")}.`)
	}

	const pending = new Map(entries.map((entry) => [entry.workItemId, { ...entry, remainingDeps: new Set(entry.dependsOn) }]))
	const sequence: MergeOrderEntry[] = []
	while (pending.size > 0) {
		const ready = Array.from(pending.values())
			.filter((entry) => entry.remainingDeps.size === 0)
			.sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
		if (ready.length === 0) {
			blockers.push("Merge order could not resolve a dependency-safe sequence.")
			break
		}

		const next = ready[0]
		if (!next) break
		const order = sequence.length + 1
		sequence.push({
			workItemId: next.workItemId,
			assignmentId: next.assignmentId,
			branchName: next.branchName,
			order,
			dependsOn: [...next.dependsOn],
			reason: next.dependsOn.length > 0 ? `Depends on ${next.dependsOn.join(", ")}.` : "No prerequisite work items.",
			ownedFiles: [...next.ownedFiles],
		})
		pending.delete(next.workItemId)
		for (const entry of pending.values()) {
			entry.remainingDeps.delete(next.workItemId)
		}
	}

	if (blockers.length > 0) {
		const blockerList = Array.from(new Set(blockers))
		return {
			schemaVersion: 1,
			status: "blocked",
			sequence,
			conflictRisks,
			blockers: blockerList,
			negotiation: buildMergeNegotiationArtifact(input.taskId, "blocked", sequence, conflictRisks, blockerList),
			summary: "Merge order blocked because dependency-safe sequencing could not be proven.",
		}
	}

	const negotiation = buildMergeNegotiationArtifact(input.taskId, "planned", sequence, conflictRisks, [])
	return {
		schemaVersion: 1,
		status: "planned",
		sequence,
		conflictRisks,
		blockers: [],
		negotiation,
		summary: `Merge order planned across ${sequence.length} work item(s).`,
	}
}

export function formatMergeOrderArtifact(artifact: MergeOrderArtifact): string {
	return [
		`Status: ${artifact.status}`,
		`Summary: ${artifact.summary}`,
		`Negotiation: ${artifact.negotiation.mode}`,
		`Readiness: ${artifact.negotiation.readiness}`,
		`Approval branch: ${artifact.negotiation.approvalBranch ?? "(none)"}`,
		`Negotiation summary: ${artifact.negotiation.summary}`,
		`Handoff summary: ${artifact.negotiation.handoffSummary}`,
		...(artifact.negotiation.reviewStages.length > 0
			? ["Review stages:", ...artifact.negotiation.reviewStages.map((stage) => `- ${stage.label}: ${stage.status} | ${stage.summary}`)]
			: []),
		...(artifact.conflictRisks.length > 0 ? ["Conflict risks:", ...artifact.conflictRisks.map((risk) => `- ${risk}`)] : []),
		...(artifact.negotiation.reviewChecklist.length > 0
			? ["Review checklist:", ...artifact.negotiation.reviewChecklist.map((item) => `- ${item}`)]
			: []),
		...(artifact.negotiation.conflictReview.length > 0
			? ["Conflict review:", ...artifact.negotiation.conflictReview.map((item) => `- ${item}`)]
			: []),
		...(artifact.blockers.length > 0 ? ["Blockers:", ...artifact.blockers.map((blocker) => `- ${blocker}`)] : []),
		"Sequence:",
		...(artifact.sequence.length > 0
			? artifact.sequence.map((entry) => `- ${entry.order}. ${entry.assignmentId} -> ${entry.branchName}`)
			: ["- (none)"]),
	].join("\n")
}
