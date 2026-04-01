import fs from "node:fs"

import { evaluateTaskAdmission, type TaskAdmissionResult } from "../run/AdmissionGate"
import {
	buildScopedTaskContract,
	extractTaskFileRefs,
	mergeTaskContracts,
	normalizeRelPath,
	type TaskContract,
} from "../run/TaskContract"

export type GuidedTaskTemplateId =
	| "comment_file"
	| "create_tiny_file"
	| "update_named_file"
	| "update_file_and_test"
	| "sync_docs_with_source"
	| "rename_export"

export type GuidedStarterTaskId =
	| "starter_add_comment"
	| "starter_create_note"
	| "starter_update_named_file"
	| "starter_update_with_test"
	| "starter_sync_docs"
	| "starter_rename_export"

export type GuidedFieldOption = {
	value: string
	label: string
}

export type GuidedSecondaryField =
	| {
			kind: "text"
			label: string
			placeholder: string
	  }
	| {
			kind: "select"
			label: string
			options: GuidedFieldOption[]
			defaultValue: string
	  }

export type GuidedTaskTemplateDefinition = {
	id: GuidedTaskTemplateId
	label: string
	description: string
	primaryLabel: string
	primaryPlaceholder: string
	expectedOutcomePlaceholder: string
	secondaryField?: GuidedSecondaryField
}

export type GuidedTaskDraftInput = {
	templateId?: string
	primaryTarget?: string
	secondaryValue?: string
	expectedOutcome?: string
	workspace?: string
}

export type GuidedTaskDraft = {
	ok: boolean
	template: GuidedTaskTemplateDefinition | null
	taskText: string
	errors: string[]
	warnings: string[]
	taskContract: TaskContract | null
	taskAdmission: TaskAdmissionResult | null
	verificationProfile: string | null
	scopePreview: string[]
}

export type GuidedStarterTaskDefinition = {
	id: GuidedStarterTaskId
	label: string
	description: string
	templateId: GuidedTaskTemplateId
	defaultPrimaryTarget: string
	defaultSecondaryValue?: string
	defaultExpectedOutcome: string
}

export const DEFAULT_GUIDED_TASK_TEMPLATE_ID: GuidedTaskTemplateId = "comment_file"

export const GUIDED_TASK_TEMPLATES: GuidedTaskTemplateDefinition[] = [
	{
		id: "comment_file",
		label: "Add or improve a comment",
		description: "Safe single-file task for a small comment or clarification in one named file.",
		primaryLabel: "File to comment",
		primaryPlaceholder: "src/hello.ts",
		expectedOutcomePlaceholder: "Explain what should be clearer, such as startup behavior or a confusing branch.",
	},
	{
		id: "create_tiny_file",
		label: "Create one tiny file",
		description: "Safe single-file create task for one small note, helper stub, or starter file.",
		primaryLabel: "File to create",
		primaryPlaceholder: "notes.md",
		expectedOutcomePlaceholder: "Describe what the new file should contain, such as one sentence about the repo.",
	},
	{
		id: "update_named_file",
		label: "Update one named file",
		description: "Safe single-file edit when you know exactly which file should change.",
		primaryLabel: "File to update",
		primaryPlaceholder: "src/config.ts",
		expectedOutcomePlaceholder: "Describe the focused outcome, such as clarify wording or tweak one helper.",
	},
	{
		id: "update_file_and_test",
		label: "Update a file and its test",
		description: "Semi-open helper-plus-test lane: one named source file plus its nearby test.",
		primaryLabel: "Source file",
		primaryPlaceholder: "src/format.ts",
		expectedOutcomePlaceholder: "Describe the intended behavior change or bug fix.",
	},
	{
		id: "sync_docs_with_source",
		label: "Sync docs with one source file",
		description: "Semi-open docs-sync lane: one named source file plus one bounded docs target.",
		primaryLabel: "Source file",
		primaryPlaceholder: "src/config.ts",
		expectedOutcomePlaceholder: "Describe what the docs should explain after the sync.",
		secondaryField: {
			kind: "select",
			label: "Docs target",
			defaultValue: "readme",
			options: [
				{ value: "readme", label: "README" },
				{ value: "guide", label: "Guide" },
				{ value: "faq", label: "FAQ" },
				{ value: "docs", label: "Docs" },
			],
		},
	},
	{
		id: "rename_export",
		label: "Rename one export and call sites",
		description: "Semi-open rename lane: one named source file plus direct local call sites.",
		primaryLabel: "Source file",
		primaryPlaceholder: "src/format.ts",
		expectedOutcomePlaceholder: "Describe any extra rename intent, such as making the name clearer.",
		secondaryField: {
			kind: "text",
			label: "New export name",
			placeholder: "formatLine",
		},
	},
]

export const GUIDED_TASK_LIBRARY_V2: GuidedStarterTaskDefinition[] = [
	{
		id: "starter_add_comment",
		label: "Add one comment",
		description: "The lowest-risk first task: clarify one named file with a small comment.",
		templateId: "comment_file",
		defaultPrimaryTarget: "hello.ts",
		defaultExpectedOutcome: "the startup flow",
	},
	{
		id: "starter_create_note",
		label: "Create one note file",
		description: "Create one tiny named file with a short sentence so the diff is easy to inspect.",
		templateId: "create_tiny_file",
		defaultPrimaryTarget: "notes.md",
		defaultExpectedOutcome: "one sentence describing this repo",
	},
	{
		id: "starter_update_named_file",
		label: "Update one named file",
		description: "Use this when you already know exactly which file should change and want to stay narrow.",
		templateId: "update_named_file",
		defaultPrimaryTarget: "src/config.ts",
		defaultExpectedOutcome: "clarify one focused behavior",
	},
	{
		id: "starter_update_with_test",
		label: "Update file and test",
		description: "A bounded helper-plus-test lane for one named source file and its nearby test.",
		templateId: "update_file_and_test",
		defaultPrimaryTarget: "src/format.ts",
		defaultExpectedOutcome: "the formatter output stays consistent",
	},
	{
		id: "starter_sync_docs",
		label: "Sync docs with source",
		description: "A bounded docs-sync lane for one named source file and one docs target.",
		templateId: "sync_docs_with_source",
		defaultPrimaryTarget: "src/config.ts",
		defaultSecondaryValue: "readme",
		defaultExpectedOutcome: "the config behavior",
	},
	{
		id: "starter_rename_export",
		label: "Rename one export",
		description: "A bounded rename lane for one named source file plus direct local call sites.",
		templateId: "rename_export",
		defaultPrimaryTarget: "src/format.ts",
		defaultSecondaryValue: "formatLine",
		defaultExpectedOutcome: "the export name is clearer",
	},
]

function getTemplate(templateId: string | undefined): GuidedTaskTemplateDefinition | null {
	return GUIDED_TASK_TEMPLATES.find((template) => template.id === templateId) ?? null
}

export function findGuidedStarterTask(starterId: string | undefined): GuidedStarterTaskDefinition | null {
	return GUIDED_TASK_LIBRARY_V2.find((starter) => starter.id === starterId) ?? null
}

function formatDecisionLabel(decision: TaskAdmissionResult["decision"]): string {
	switch (decision) {
		case "allow":
			return "ALLOW"
		case "allow_with_review_bias":
			return "ALLOW WITH REVIEW BIAS"
		case "refuse":
			return "REFUSE"
	}
}

function normalizeFreeText(value: string | undefined): string {
	return String(value ?? "").trim()
}

function normalizePrimaryTarget(value: string | undefined): string {
	return normalizeRelPath(normalizeFreeText(value))
}

function normalizeExpectedOutcome(value: string | undefined): string {
	return normalizeFreeText(value).replace(/\s+/g, " ")
}

function normalizeSecondaryValue(template: GuidedTaskTemplateDefinition, rawValue: string | undefined): string {
	const value = normalizeFreeText(rawValue)
	if (!template.secondaryField) return value
	if (template.secondaryField.kind === "select") {
		const allowed = new Set(template.secondaryField.options.map((option) => option.value))
		if (!value) return template.secondaryField.defaultValue
		return allowed.has(value) ? value : value.toLowerCase()
	}
	return value
}

function containsUnexpectedFileRef(value: string): boolean {
	return extractTaskFileRefs(value).length > 0
}

function buildCreateFileContract(targetFile: string): TaskContract {
	return (
		mergeTaskContracts(buildScopedTaskContract([targetFile]), {
			acceptance: {
				requiredCreatedFiles: [targetFile],
			},
		}) ?? buildScopedTaskContract([targetFile])
	)
}

function inferExplicitTemplateContract(templateId: GuidedTaskTemplateId, primaryTarget: string): TaskContract | null {
	if (!primaryTarget) return null
	if (templateId === "create_tiny_file") return buildCreateFileContract(primaryTarget)
	if (templateId === "comment_file" || templateId === "update_named_file") return buildScopedTaskContract([primaryTarget])
	return null
}

function buildTaskText(
	templateId: GuidedTaskTemplateId,
	primaryTarget: string,
	secondaryValue: string,
	expectedOutcome: string,
): string {
	const outcomeSuffix =
		expectedOutcome.length > 0
			? {
					comment_file: ` about ${expectedOutcome}`,
					create_tiny_file: ` with ${expectedOutcome}`,
					update_named_file: ` to ${expectedOutcome}`,
					update_file_and_test: ` so that ${expectedOutcome}`,
					sync_docs_with_source: ` so the docs explain ${expectedOutcome}`,
					rename_export: ` while keeping the intent focused on ${expectedOutcome}`,
			  }[templateId]
			: ""

	switch (templateId) {
		case "comment_file":
			return `add a brief comment to ${primaryTarget}${outcomeSuffix}`
		case "create_tiny_file":
			return expectedOutcome.length > 0
				? `create ${primaryTarget}${outcomeSuffix}`
				: `create ${primaryTarget} with a small, focused starter file`
		case "update_named_file":
			return expectedOutcome.length > 0 ? `update ${primaryTarget}${outcomeSuffix}` : `update ${primaryTarget}`
		case "update_file_and_test":
			return expectedOutcome.length > 0
				? `update ${primaryTarget} and keep its test aligned${outcomeSuffix}`
				: `update ${primaryTarget} and keep its test aligned`
		case "sync_docs_with_source": {
			const docLead =
				secondaryValue === "guide"
					? "sync the guide docs"
					: secondaryValue === "faq"
						? "sync the faq docs"
						: secondaryValue === "docs"
							? "sync the docs"
							: "sync the repo-root readme"
			return expectedOutcome.length > 0
				? `${docLead} with ${primaryTarget}${outcomeSuffix}`
				: `${docLead} with ${primaryTarget}`
		}
		case "rename_export":
			return secondaryValue.length > 0
				? `rename the export in ${primaryTarget} to ${secondaryValue} and update its direct call sites${outcomeSuffix}`
				: `rename the export in ${primaryTarget} and update its direct call sites${outcomeSuffix}`
	}
}

function validateDraft(
	template: GuidedTaskTemplateDefinition | null,
	primaryTarget: string,
	secondaryValue: string,
	expectedOutcome: string,
): string[] {
	const errors: string[] = []
	if (!template) {
		errors.push("Choose a guided template before launching the CLI.")
		return errors
	}

	if (!primaryTarget) {
		errors.push(`${template.primaryLabel} is required.`)
	}

	if (expectedOutcome.length > 0 && containsUnexpectedFileRef(expectedOutcome)) {
		errors.push("Expected outcome should describe the result, not add more file paths.")
	}

	if (template.id === "sync_docs_with_source" && template.secondaryField?.kind === "select") {
		const allowedValues = new Set(template.secondaryField.options.map((option) => option.value))
		if (!allowedValues.has(secondaryValue)) {
			errors.push(
				`${template.secondaryField.label} must be one of: ${template.secondaryField.options.map((option) => option.label).join(", ")}.`,
			)
		}
	}

	if (template.id === "rename_export") {
		if (!secondaryValue) {
			errors.push("New export name is required for the rename template.")
		} else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(secondaryValue)) {
			errors.push("New export name must look like a simple identifier, not a path or sentence.")
		}
	}

	return errors
}

export function buildGuidedTaskDraft(input: GuidedTaskDraftInput): GuidedTaskDraft {
	const template = getTemplate(input.templateId)
	const primaryTarget = normalizePrimaryTarget(input.primaryTarget)
	const expectedOutcome = normalizeExpectedOutcome(input.expectedOutcome)
	const secondaryValue = template ? normalizeSecondaryValue(template, input.secondaryValue) : normalizeFreeText(input.secondaryValue)
	const errors = validateDraft(template, primaryTarget, secondaryValue, expectedOutcome)

	if (!template || errors.length > 0) {
		return {
			ok: false,
			template,
			taskText: "",
			errors,
			warnings: [],
			taskContract: template ? inferExplicitTemplateContract(template.id, primaryTarget) : null,
			taskAdmission: null,
			verificationProfile: null,
			scopePreview: [],
		}
	}

	const taskText = buildTaskText(template.id, primaryTarget, secondaryValue, expectedOutcome)
	const workspace = normalizeFreeText(input.workspace)
	const canPreviewAdmission = workspace.length > 0 && fs.existsSync(workspace) && fs.statSync(workspace).isDirectory()
	const taskAdmission = canPreviewAdmission ? evaluateTaskAdmission(taskText, workspace) : null
	const inferredContract = inferExplicitTemplateContract(template.id, primaryTarget)
	const taskContract = taskAdmission?.derivedTaskContract ?? inferredContract
	const warnings: string[] = []

	if (!canPreviewAdmission) {
		warnings.push("Select a real workspace to preview bounded scope and admission warnings.")
	}
	if (taskAdmission?.decision === "allow_with_review_bias") {
		warnings.push("This task is admissible, but it lands with review bias instead of the narrowest safe lane.")
	}
	if (taskAdmission?.decision === "refuse") {
		warnings.push("This template draft is currently outside the proven admission lane.")
	}

	return {
		ok: true,
		template,
		taskText,
		errors: [],
		warnings,
		taskContract,
		taskAdmission,
		verificationProfile: taskAdmission?.verificationProfile ?? null,
		scopePreview: taskContract?.scope?.allowedFiles ?? taskContract?.scope?.requiredTargetFiles ?? [],
	}
}

export function buildGuidedStarterTaskDraft(input: {
	starterId?: string
	workspace?: string
	primaryTarget?: string
	secondaryValue?: string
	expectedOutcome?: string
}): GuidedTaskDraft {
	const starter = findGuidedStarterTask(input.starterId)
	if (!starter) {
		return {
			ok: false,
			template: null,
			taskText: "",
			errors: ["Choose a starter task before previewing the guided library draft."],
			warnings: [],
			taskContract: null,
			taskAdmission: null,
			verificationProfile: null,
			scopePreview: [],
		}
	}

	return buildGuidedTaskDraft({
		templateId: starter.templateId,
		primaryTarget: input.primaryTarget ?? starter.defaultPrimaryTarget,
		secondaryValue: input.secondaryValue ?? starter.defaultSecondaryValue,
		expectedOutcome: input.expectedOutcome ?? starter.defaultExpectedOutcome,
		workspace: input.workspace,
	})
}

export function formatGuidedTaskDraft(draft: GuidedTaskDraft): string {
	const lines: string[] = []
	lines.push(`Template: ${draft.template?.label ?? "Choose a template"}`)

	if (!draft.ok) {
		lines.push("Status: blocked")
		if (draft.errors.length > 0) {
			lines.push("Blocked because:")
			lines.push(...draft.errors.map((error) => `- ${error}`))
		}
		if (draft.taskContract) {
			lines.push("Current explicit scope preview:")
			lines.push(...(draft.taskContract.scope?.allowedFiles ?? []).map((file) => `- ${file}`))
		}
		return lines.join("\n")
	}

	lines.push("Generated task:")
	lines.push(draft.taskText)

	if (draft.scopePreview.length > 0) {
		lines.push("Expected file scope:")
		lines.push(...draft.scopePreview.map((file) => `- ${file}`))
	} else {
		lines.push("Expected file scope: select a workspace to derive it.")
	}

	if (draft.verificationProfile) {
		lines.push(`Verification profile: ${draft.verificationProfile}`)
	} else {
		lines.push("Verification profile: none detected")
	}

	if (draft.taskAdmission) {
		lines.push(`Admission preview: ${formatDecisionLabel(draft.taskAdmission.decision)}`)
		if (draft.taskAdmission.reasonCodes.length > 0) {
			lines.push(`Reason codes: ${draft.taskAdmission.reasonCodes.join(", ")}`)
		}
		if (draft.taskAdmission.details.length > 0) {
			lines.push(...draft.taskAdmission.details.map((detail) => `- ${detail}`))
		}
	} else {
		lines.push("Admission preview: select a real workspace to compute it.")
	}

	if (draft.warnings.length > 0) {
		lines.push("Warnings:")
		lines.push(...draft.warnings.map((warning) => `- ${warning}`))
	}

	return lines.join("\n")
}

export function formatGuidedTaskLibrary(): string {
	return [
		"Starter library:",
		...GUIDED_TASK_LIBRARY_V2.map((starter) => `- ${starter.label}: ${starter.description}`),
		"",
		"Every starter still goes through the same admission preview, task contract, run artifacts, and review flow as a free-form task.",
	].join("\n")
}

export function formatTaskContractPreview(contract: TaskContract | null, fallbackMessage: string): string {
	if (!contract) return fallbackMessage
	return JSON.stringify(contract, null, 2)
}
