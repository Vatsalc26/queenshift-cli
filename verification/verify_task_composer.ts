import { buildTaskComposerDraft, formatTaskComposerPreview } from "../src/owner/TaskComposer"

export type TaskComposerHarnessResult = {
	structuredFieldsComposeTask: boolean
	finalPromptPreviewVisible: boolean
	lanePreviewVisible: boolean
	calmDefaultVisible: boolean
	presetEvidenceVisible: boolean
	notesRemainTransparent: boolean
	details: string[]
}

export async function runTaskComposerHarness(): Promise<TaskComposerHarnessResult> {
	const details: string[] = []

	const smallDraft = buildTaskComposerDraft({
		goalType: "comment_file",
		primaryTarget: "hello.ts",
		expectedOutcome: "the startup flow",
		workspace: ".",
	})
	const mediumDraft = buildTaskComposerDraft({
		goalType: "rename_export",
		primaryTarget: "src/format.ts",
		secondaryValue: "formatValue",
		expectedOutcome: "the rename is easier to read",
		notes: "preserve the current behavior",
	})
	const previewText = formatTaskComposerPreview(mediumDraft)

	const structuredFieldsComposeTask =
		smallDraft.ok &&
		smallDraft.finalTaskText === "add a brief comment to hello.ts about the startup flow" &&
		mediumDraft.ok &&
		mediumDraft.finalTaskText.includes("rename the export in src/format.ts to formatValue") &&
		mediumDraft.finalTaskText.includes("Constraint notes: preserve the current behavior")
	const finalPromptPreviewVisible =
		previewText.includes("Final task:") &&
		previewText.includes("rename the export in src/format.ts to formatValue")
	const lanePreviewVisible =
		previewText.includes("Lane preview:") &&
		mediumDraft.lanePreview.length > 0 &&
		smallDraft.lanePreview.length > 0
	const calmDefaultVisible =
		previewText.includes("Calm default:") &&
		mediumDraft.calmDefaultStep.includes("Check Admission") &&
		smallDraft.calmDefaultStep.includes("Check Admission")
	const presetEvidenceVisible =
		previewText.includes("Preset:") &&
		previewText.includes("Corpus evidence:") &&
		typeof mediumDraft.presetLabel === "string" &&
		mediumDraft.presetLabel.length > 0 &&
		typeof smallDraft.presetEvidence === "string" &&
		smallDraft.presetEvidence.includes("owner")
	const notesRemainTransparent = mediumDraft.notesApplied && previewText.includes("Constraint notes: preserve the current behavior")

	details.push(`small=${smallDraft.finalTaskText}`)
	details.push(`medium=${mediumDraft.finalTaskText}`)

	return {
		structuredFieldsComposeTask,
		finalPromptPreviewVisible,
		lanePreviewVisible,
		calmDefaultVisible,
		presetEvidenceVisible,
		notesRemainTransparent,
		details,
	}
}

export function formatTaskComposerHarnessResult(result: TaskComposerHarnessResult): string {
	return [
		`Structured fields compose task: ${result.structuredFieldsComposeTask ? "PASS" : "FAIL"}`,
		`Final prompt preview visible: ${result.finalPromptPreviewVisible ? "PASS" : "FAIL"}`,
		`Lane preview visible: ${result.lanePreviewVisible ? "PASS" : "FAIL"}`,
		`Calm default visible: ${result.calmDefaultVisible ? "PASS" : "FAIL"}`,
		`Preset evidence visible: ${result.presetEvidenceVisible ? "PASS" : "FAIL"}`,
		`Notes remain transparent: ${result.notesRemainTransparent ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runTaskComposerHarness()
	console.log(formatTaskComposerHarnessResult(result))
	process.exit(
		result.structuredFieldsComposeTask &&
			result.finalPromptPreviewVisible &&
			result.lanePreviewVisible &&
			result.calmDefaultVisible &&
			result.presetEvidenceVisible &&
			result.notesRemainTransparent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:task-composer] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
