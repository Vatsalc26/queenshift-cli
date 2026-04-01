export type SwarmRoleManualId = "supervisor" | "builder" | "critic" | "reviewer"
export type WorkerSpecializationId =
	| "solo_owner"
	| "parallel_owner"
	| "follow_on_owner"
	| "rename_anchor_owner"
	| "docs_config_owner"
	| "medium_bucket_owner"

export type RoleManualDefinition = {
	role: SwarmRoleManualId
	version: string
	source: string
	summary: string
	rules: string[]
}

export type RoleManualReference = {
	role: SwarmRoleManualId
	version: string
	source: string
	summary: string
}

export type WorkerSpecializationDefinition = {
	id: WorkerSpecializationId
	label: string
	summary: string
	rules: string[]
}

const ROLE_MANUALS: Record<SwarmRoleManualId, RoleManualDefinition> = {
	supervisor: {
		role: "supervisor",
		version: "v1",
		source: "legacy_v1_role_discipline",
		summary: "Plan only bounded work with explicit ownership and fail closed when scope or dependencies are unclear.",
		rules: [
			"Create stable subtask ids before handing work to builders.",
			"Assign non-overlapping owned files or boundaries to each builder.",
			"Keep dependency order explicit instead of implying coordination.",
			"Prefer smaller bounded subtasks over clever but vague decomposition.",
			"Refuse or fall back deterministically when evidence is insufficient.",
		],
	},
	builder: {
		role: "builder",
		version: "v1",
		source: "legacy_v1_role_discipline",
		summary: "Builders own only their assigned files, keep diffs minimal, and never widen scope while claiming completion.",
		rules: [
			"Touch only the files explicitly assigned to this builder.",
			"Read before write on the tool-call lane and keep edits minimal on every lane.",
			"Use context files as read-only reference unless they are explicitly editable.",
			"Do not invent extra files, commands, or hidden follow-up work.",
			"Completion claims must stay subordinate to reviewer, acceptance, and verification truth.",
		],
	},
	critic: {
		role: "critic",
		version: "v1",
		source: "legacy_v1_role_discipline",
		summary: "Critic output stays structured, evidence-backed, and separate from execution truth.",
		rules: [
			"Record only structured concerns tied to visible evidence.",
			"Recommend one safer next action instead of vague worry.",
			"Keep critique advisory; do not overwrite reviewer or run status truth.",
			"Prefer bounded retry or refusal over generic rerun language.",
		],
	},
	reviewer: {
		role: "reviewer",
		version: "v1",
		source: "legacy_v1_role_discipline",
		summary: "Reviewer output fails closed on ambiguity and judges correctness, completeness, and safety over style polish.",
		rules: [
			"Return PASS only when the bounded task looks satisfied overall.",
			"Return NEEDS_WORK for substantive correctness, completeness, or safety issues.",
			"Fail closed when evidence or output formatting is unclear.",
			"Keep findings short, specific, and grounded in the supplied diff evidence.",
		],
	},
}

const WORKER_SPECIALIZATIONS: Record<WorkerSpecializationId, WorkerSpecializationDefinition> = {
	solo_owner: {
		id: "solo_owner",
		label: "Solo owner",
		summary: "One builder owns the full bounded change and should refuse to invent parallel coordination.",
		rules: [
			"Finish the bounded task without inventing helper workers or extra files.",
			"Keep every edit anchored to the explicit task contract and reviewer proof.",
		],
	},
	parallel_owner: {
		id: "parallel_owner",
		label: "Parallel owner",
		summary: "Own one disjoint file bucket and avoid hidden dependency chatter unless the graph allows it.",
		rules: [
			"Stay inside the assigned bucket and leave neighbor buckets untouched.",
			"Escalate through explicit ask-sibling or review artifacts instead of improvising overlap.",
		],
	},
	follow_on_owner: {
		id: "follow_on_owner",
		label: "Follow-on owner",
		summary: "Wait for the prerequisite owner, then land the dependent change without rewriting the earlier bucket.",
		rules: [
			"Treat dependency reasons as hard sequencing, not soft hints.",
			"Preserve the anchor owner's output unless the bounded task explicitly says otherwise.",
		],
	},
	rename_anchor_owner: {
		id: "rename_anchor_owner",
		label: "Rename anchor owner",
		summary: "Own the anchor file of a bounded rename and establish the canonical symbol shape before follow-on edits.",
		rules: [
			"Keep the anchor rename explicit and consistent with the task contract.",
			"Do not pre-emptively widen into follow-on files owned by another worker.",
		],
	},
	docs_config_owner: {
		id: "docs_config_owner",
		label: "Docs/config owner",
		summary: "Mirror bounded code truth into docs or config files without drifting into wider cleanup.",
		rules: [
			"Copy required literal text exactly when the task contract demands it.",
			"Do not invent broader doc or config rewrites beyond the assigned file set.",
		],
	},
	medium_bucket_owner: {
		id: "medium_bucket_owner",
		label: "Medium bucket owner",
		summary: "Own one bounded medium-lane bucket and keep cross-bucket drift small enough for critic review to stay meaningful.",
		rules: [
			"Prefer small, local edits inside the assigned medium bucket.",
			"Leave cross-bucket coordination to explicit artifacts, not implicit rewrites.",
		],
	},
}

export function getRoleManual(role: SwarmRoleManualId): RoleManualDefinition {
	return ROLE_MANUALS[role]
}

export function getWorkerSpecialization(id: WorkerSpecializationId): WorkerSpecializationDefinition {
	return WORKER_SPECIALIZATIONS[id]
}

export function listRoleManualReferences(roles?: SwarmRoleManualId[]): RoleManualReference[] {
	const orderedRoles = roles ?? (Object.keys(ROLE_MANUALS) as SwarmRoleManualId[])
	return orderedRoles.map((role) => {
		const manual = getRoleManual(role)
		return {
			role: manual.role,
			version: manual.version,
			source: manual.source,
			summary: manual.summary,
		}
	})
}

export function formatRoleManualPrompt(
	role: SwarmRoleManualId,
	options: {
		specializationId?: WorkerSpecializationId | null
		teamShapeSummary?: string | null
	} = {},
): string {
	const manual = getRoleManual(role)
	const specialization =
		role === "builder" && options.specializationId ? getWorkerSpecialization(options.specializationId) : null
	return [
		`Role manual: ${manual.role} ${manual.version} (${manual.source})`,
		`Summary: ${manual.summary}`,
		options.teamShapeSummary?.trim() ? `Team shape guidance: ${options.teamShapeSummary.trim()}` : null,
		...(specialization
			? [
					`Worker specialization: ${specialization.label} (${specialization.id})`,
					`Specialization summary: ${specialization.summary}`,
					"Specialization rules:",
					...specialization.rules.map((rule, index) => `${index + 1}. ${rule}`),
			  ]
			: []),
		"Rules:",
		...manual.rules.map((rule, index) => `${index + 1}. ${rule}`),
	]
		.filter((value): value is string => Boolean(value))
		.join("\n")
}

export function formatRoleManualCatalog(): string {
	return listRoleManualReferences()
		.map((manual) => `${manual.role}: ${manual.version} | ${manual.source} | ${manual.summary}`)
		.join("\n")
}

export function formatWorkerSpecializationCatalog(): string {
	return Object.values(WORKER_SPECIALIZATIONS)
		.map((specialization) => `${specialization.id}: ${specialization.label} | ${specialization.summary}`)
		.join("\n")
}
