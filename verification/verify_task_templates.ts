import fs from "node:fs"
import path from "node:path"

import { buildGuidedTaskDraft, formatGuidedTaskDraft } from "../src/shell/GuidedTaskTemplates"

export type TaskTemplateHarnessResult = {
	templateGeneratesExpectedTaskContract: boolean
	missingRequiredFieldBlocked: boolean
	previewShowsExpectedScope: boolean
	unsupportedTemplateOptionRefused: boolean
	guidedTaskRoutesThroughAdmission: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

export async function runTaskTemplateHarness(rootDir = resolveRootDir()): Promise<TaskTemplateHarnessResult> {
	const details: string[] = []
	const testWorkspace = path.join(rootDir, "verification", "test_workspace")
	const tsCliTemplate = path.join(rootDir, "verification", "beta_repo_templates", "ts_cli_tool")
	const configServiceTemplate = path.join(rootDir, "verification", "beta_repo_templates", "config_service")

	const commentDraft = buildGuidedTaskDraft({
		templateId: "comment_file",
		primaryTarget: "hello.ts",
		expectedOutcome: "startup flow",
		workspace: testWorkspace,
	})
	const templateGeneratesExpectedTaskContract =
		commentDraft.ok &&
		commentDraft.taskText === "add a brief comment to hello.ts about startup flow" &&
		(commentDraft.taskContract?.scope?.allowedFiles ?? []).join(",") === "hello.ts"
	details.push(`comment scope=${(commentDraft.taskContract?.scope?.allowedFiles ?? []).join(",") || "(none)"}`)

	const missingFieldDraft = buildGuidedTaskDraft({
		templateId: "update_named_file",
		primaryTarget: "",
		workspace: testWorkspace,
	})
	const missingRequiredFieldBlocked =
		missingFieldDraft.ok === false && missingFieldDraft.errors.some((error) => error.includes("File to update is required"))
	details.push(`missing-field errors=${missingFieldDraft.errors.join(" | ") || "(none)"}`)

	const helperDraft = buildGuidedTaskDraft({
		templateId: "update_file_and_test",
		primaryTarget: "src/format.ts",
		expectedOutcome: "the formatter output stays consistent",
		workspace: tsCliTemplate,
	})
	const helperPreviewText = formatGuidedTaskDraft(helperDraft)
	const previewShowsExpectedScope =
		helperDraft.ok &&
		helperPreviewText.includes("src/format.ts") &&
		helperPreviewText.includes("src/format.test.ts") &&
		helperDraft.taskContract?.derivation?.taskClass === "helper_test"
	details.push(`helper preview scope=${helperDraft.scopePreview.join(",") || "(none)"}`)

	const unsupportedOptionDraft = buildGuidedTaskDraft({
		templateId: "sync_docs_with_source",
		primaryTarget: "src/config.ts",
		secondaryValue: "release-notes",
		workspace: configServiceTemplate,
	})
	const unsupportedTemplateOptionRefused =
		unsupportedOptionDraft.ok === false &&
		unsupportedOptionDraft.errors.some((error) => error.includes("Docs target must be one of"))
	details.push(`unsupported-option errors=${unsupportedOptionDraft.errors.join(" | ") || "(none)"}`)

	const docsDraft = buildGuidedTaskDraft({
		templateId: "sync_docs_with_source",
		primaryTarget: "src/config.ts",
		secondaryValue: "readme",
		expectedOutcome: "the config behavior",
		workspace: configServiceTemplate,
	})
	const guidedTaskRoutesThroughAdmission =
		docsDraft.ok &&
		docsDraft.taskAdmission?.decision === "allow_with_review_bias" &&
		(docsDraft.taskAdmission?.reasonCodes ?? []).includes("semi_open_task") &&
		docsDraft.verificationProfile === "local-node-verify-script"
	details.push(
		`docs admission=${docsDraft.taskAdmission?.decision ?? "null"} profile=${docsDraft.verificationProfile ?? "none"} task=${docsDraft.taskText || "(none)"}`,
	)

	return {
		templateGeneratesExpectedTaskContract,
		missingRequiredFieldBlocked,
		previewShowsExpectedScope,
		unsupportedTemplateOptionRefused,
		guidedTaskRoutesThroughAdmission,
		details,
	}
}

export function formatTaskTemplateHarnessResult(result: TaskTemplateHarnessResult): string {
	return [
		`Template generates expected task contract: ${result.templateGeneratesExpectedTaskContract ? "PASS" : "FAIL"}`,
		`Missing required field blocked: ${result.missingRequiredFieldBlocked ? "PASS" : "FAIL"}`,
		`Preview shows expected scope: ${result.previewShowsExpectedScope ? "PASS" : "FAIL"}`,
		`Unsupported template option refused: ${result.unsupportedTemplateOptionRefused ? "PASS" : "FAIL"}`,
		`Guided task still routes through admission: ${result.guidedTaskRoutesThroughAdmission ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runTaskTemplateHarness()
	console.log(formatTaskTemplateHarnessResult(result))
	process.exit(
		result.templateGeneratesExpectedTaskContract &&
			result.missingRequiredFieldBlocked &&
			result.previewShowsExpectedScope &&
			result.unsupportedTemplateOptionRefused &&
			result.guidedTaskRoutesThroughAdmission
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:task:templates] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
