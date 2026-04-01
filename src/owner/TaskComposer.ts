import {
	buildGuidedTaskDraft,
	type GuidedTaskDraft,
	type GuidedTaskTemplateId,
} from "../shell/GuidedTaskTemplates"
import { findPresetForTemplate } from "./GuidedPresetLibrary"

export type TaskComposerInput = {
	goalType?: GuidedTaskTemplateId | string
	primaryTarget?: string
	secondaryValue?: string
	expectedOutcome?: string
	notes?: string
	workspace?: string
}

export type TaskComposerDraft = {
	ok: boolean
	goalType: GuidedTaskTemplateId | null
	goalLabel: string
	finalTaskText: string
	lanePreview: string
	calmDefaultStep: string
	presetLabel: string | null
	presetEvidence: string | null
	presetReason: string | null
	notesApplied: boolean
	errors: string[]
	warnings: string[]
	scopePreview: string[]
	taskContract: GuidedTaskDraft["taskContract"]
	taskAdmission: GuidedTaskDraft["taskAdmission"]
}

function normalizeNotes(value: string | undefined): string {
	return String(value ?? "").trim().replace(/\s+/g, " ")
}

function classifyLanePreview(draft: GuidedTaskDraft): string {
	if (!draft.taskAdmission) return "unknown until a real workspace is selected"
	switch (draft.taskAdmission.decision) {
		case "allow":
			return draft.scopePreview.length <= 1 ? "small bounded" : "bounded"
		case "allow_with_review_bias":
			return "review-biased bounded"
		case "refuse":
			return "currently unsupported"
	}
}

function buildCalmDefaultStep(draft: GuidedTaskDraft): string {
	if (!draft.ok) return "Fill the required guided fields before launching."
	if (!draft.taskAdmission) return "Select a real workspace, then use Check Admission before launching."
	switch (draft.taskAdmission.decision) {
		case "allow":
			return "Use Check Admission, then run only if the previewed scope still matches."
		case "allow_with_review_bias":
			return "Use Check Admission, then expect human review before treating the run as done."
		case "refuse":
			return "Switch to a corpus-backed starter preset or narrow the named file before launching."
	}
}

export function buildTaskComposerDraft(input: TaskComposerInput): TaskComposerDraft {
	const baseDraft = buildGuidedTaskDraft({
		templateId: input.goalType,
		primaryTarget: input.primaryTarget,
		secondaryValue: input.secondaryValue,
		expectedOutcome: input.expectedOutcome,
		workspace: input.workspace,
	})
	const notes = normalizeNotes(input.notes)
	const notesApplied = Boolean(notes)
	const finalTaskText = baseDraft.taskText ? `${baseDraft.taskText}${notesApplied ? `. Constraint notes: ${notes}` : ""}` : ""
	const preset = findPresetForTemplate((baseDraft.template?.id ?? null) as GuidedTaskTemplateId | null)

	return {
		ok: baseDraft.ok,
		goalType: (baseDraft.template?.id ?? null) as GuidedTaskTemplateId | null,
		goalLabel: baseDraft.template?.label ?? "Choose a task goal",
		finalTaskText,
		lanePreview: classifyLanePreview(baseDraft),
		calmDefaultStep: buildCalmDefaultStep(baseDraft),
		presetLabel: preset?.label ?? null,
		presetEvidence: preset?.evidenceSummary ?? null,
		presetReason: preset?.reason ?? null,
		notesApplied,
		errors: [...baseDraft.errors],
		warnings: [...baseDraft.warnings],
		scopePreview: [...baseDraft.scopePreview],
		taskContract: baseDraft.taskContract,
		taskAdmission: baseDraft.taskAdmission,
	}
}

export function formatTaskComposerPreview(draft: TaskComposerDraft): string {
	const lines = [`Goal type: ${draft.goalLabel}`]

	if (!draft.ok) {
		lines.push("Status: blocked")
		lines.push(`Calm default: ${draft.calmDefaultStep}`)
		if (draft.errors.length > 0) {
			lines.push("Blocked because:")
			lines.push(...draft.errors.map((error) => `- ${error}`))
		}
		return lines.join("\n")
	}

	lines.push("Final task:")
	lines.push(draft.finalTaskText)
	lines.push(`Lane preview: ${draft.lanePreview}`)
	lines.push(`Calm default: ${draft.calmDefaultStep}`)
	if (draft.presetLabel) {
		lines.push(`Preset: ${draft.presetLabel}`)
	}
	if (draft.presetEvidence) {
		lines.push(`Corpus evidence: ${draft.presetEvidence}`)
	}
	if (draft.presetReason) {
		lines.push(`Preset reason: ${draft.presetReason}`)
	}
	lines.push(`Scope preview: ${draft.scopePreview.join(", ") || "(none yet)"}`)

	if (draft.taskAdmission) {
		lines.push(`Admission preview: ${draft.taskAdmission.decision.toUpperCase()}`)
		if (draft.taskAdmission.reasonCodes.length > 0) {
			lines.push(`Reason codes: ${draft.taskAdmission.reasonCodes.join(", ")}`)
		}
	}

	if (draft.warnings.length > 0) {
		lines.push("Warnings:")
		lines.push(...draft.warnings.map((warning) => `- ${warning}`))
	}

	return lines.join("\n")
}
