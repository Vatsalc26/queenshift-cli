import fs from "node:fs"
import path from "node:path"

import {
	buildGuidedStarterTaskDraft,
	formatGuidedTaskLibrary,
	type GuidedTaskDraft,
} from "../src/shell/GuidedTaskTemplates"
import { buildGuidedPresetLibrary, formatGuidedPresetLibrary } from "../src/owner/GuidedPresetLibrary"

export type OwnerTaskLibraryHarnessResult = {
	starterLibraryVisible: boolean
	starterDraftIsTransparent: boolean
	parameterSlotsWork: boolean
	starterStillRoutesThroughAdmission: boolean
	presetEvidenceVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function summarizeDraft(draft: GuidedTaskDraft): string {
	return `ok=${draft.ok} task=${draft.taskText || "(none)"} scope=${draft.scopePreview.join(",") || "(none)"}`
}

export async function runOwnerTaskLibraryHarness(rootDir = resolveRootDir()): Promise<OwnerTaskLibraryHarnessResult> {
	const details: string[] = []
	const testWorkspace = path.join(rootDir, "verification", "test_workspace")
	const configServiceTemplate = path.join(rootDir, "verification", "beta_repo_templates", "config_service")
	const tsCliTemplate = path.join(rootDir, "verification", "beta_repo_templates", "ts_cli_tool")

	const libraryText = formatGuidedTaskLibrary()
	const presetText = formatGuidedPresetLibrary(rootDir)
	const presetLibrary = buildGuidedPresetLibrary(rootDir)
	const starterLibraryVisible =
		libraryText.includes("Starter library:") &&
		libraryText.includes("Add one comment") &&
		libraryText.includes("Create one note file") &&
		libraryText.includes("Rename one export")

	const noteDraft = buildGuidedStarterTaskDraft({
		starterId: "starter_create_note",
		workspace: testWorkspace,
		primaryTarget: "notes.md",
		expectedOutcome: "one sentence describing this repo",
	})
	const starterDraftIsTransparent =
		noteDraft.ok &&
		noteDraft.taskText === "create notes.md with one sentence describing this repo" &&
		(noteDraft.taskContract?.scope?.allowedFiles ?? []).join(",") === "notes.md"
	details.push(`noteDraft=${summarizeDraft(noteDraft)}`)

	const renameDraft = buildGuidedStarterTaskDraft({
		starterId: "starter_rename_export",
		workspace: tsCliTemplate,
		primaryTarget: "src/format.ts",
		secondaryValue: "formatValue",
		expectedOutcome: "the rename is easier to read",
	})
	const parameterSlotsWork =
		renameDraft.ok &&
		renameDraft.taskText.includes("formatValue") &&
		renameDraft.taskText.includes("the rename is easier to read")
	details.push(`renameDraft=${summarizeDraft(renameDraft)}`)

	const docsDraft = buildGuidedStarterTaskDraft({
		starterId: "starter_sync_docs",
		workspace: configServiceTemplate,
		primaryTarget: "src/config.ts",
		secondaryValue: "readme",
		expectedOutcome: "the config behavior",
	})
	const starterStillRoutesThroughAdmission =
		docsDraft.ok &&
		docsDraft.taskAdmission?.decision === "allow_with_review_bias" &&
		(docsDraft.taskAdmission?.reasonCodes ?? []).includes("semi_open_task") &&
		docsDraft.verificationProfile === "local-node-verify-script"
	details.push(`docsDraft=${summarizeDraft(docsDraft)}`)

	const commentPreset = presetLibrary.find((preset) => preset.starterId === "starter_add_comment")
	const presetEvidenceVisible =
		presetText.includes("Recommended presets:") &&
		presetText.includes("Corpus evidence:") === false &&
		Boolean(commentPreset && commentPreset.evidenceSummary.includes("owner") && commentPreset.recommended === false)
	details.push(`commentPreset=${commentPreset ? `${commentPreset.label} | ${commentPreset.evidenceSummary}` : "missing"}`)

	return {
		starterLibraryVisible,
		starterDraftIsTransparent,
		parameterSlotsWork,
		starterStillRoutesThroughAdmission,
		presetEvidenceVisible,
		details,
	}
}

export function formatOwnerTaskLibraryHarnessResult(result: OwnerTaskLibraryHarnessResult): string {
	return [
		`Starter library visible: ${result.starterLibraryVisible ? "PASS" : "FAIL"}`,
		`Starter draft stays transparent: ${result.starterDraftIsTransparent ? "PASS" : "FAIL"}`,
		`Parameter slots work: ${result.parameterSlotsWork ? "PASS" : "FAIL"}`,
		`Starter still routes through admission: ${result.starterStillRoutesThroughAdmission ? "PASS" : "FAIL"}`,
		`Preset evidence visible: ${result.presetEvidenceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerTaskLibraryHarness()
	console.log(formatOwnerTaskLibraryHarnessResult(result))
	process.exit(
			result.starterLibraryVisible &&
			result.starterDraftIsTransparent &&
			result.parameterSlotsWork &&
			result.starterStillRoutesThroughAdmission &&
			result.presetEvidenceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:task-library] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
