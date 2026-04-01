import { resolveRc1RootDir } from "../release/Rc1Ops"
import {
	GUIDED_TASK_LIBRARY_V2,
	buildGuidedStarterTaskDraft,
	type GuidedStarterTaskDefinition,
	type GuidedStarterTaskId,
	type GuidedTaskTemplateId,
} from "../shell/GuidedTaskTemplates"
import { buildTaskCorpusReport, type TaskCorpusReportRow } from "./TaskCorpus"

export type GuidedPresetRecommendation = {
	starterId: GuidedStarterTaskId
	label: string
	description: string
	templateId: GuidedTaskTemplateId
	sampleTaskText: string
	evidenceSummary: string
	nextFocus: string
	recommended: boolean
	reason: string
}

function formatRate(passCount: number, observed: number): string {
	if (observed <= 0) return "0/0"
	const rate = Math.round((passCount / observed) * 1000) / 10
	return `${passCount}/${observed} (${rate}%)`
}

function presetReason(row: TaskCorpusReportRow): string {
	if (row.totalObserved === 0) return "Useful preset, but still waiting on the first artifact-backed result."
	if ((row.totalSuccessRate ?? 0) < 60) return "Common enough to matter, but still needs failure-rate cleanup."
	if (row.ownerObserved === 0 && row.betaObserved > 0) return "Looks healthy in beta evidence and needs more owner use."
	return "Already supported by real bounded evidence and low-wording task entry."
}

function presetRecommended(row: TaskCorpusReportRow): boolean {
	return row.totalObserved > 0 && (row.totalSuccessRate ?? 0) >= 60
}

function sortKey(left: GuidedPresetRecommendation, right: GuidedPresetRecommendation): number {
	if (left.recommended !== right.recommended) return left.recommended ? -1 : 1
	return left.label.localeCompare(right.label)
}

function findCorpusRow(templateId: GuidedTaskTemplateId, rows: TaskCorpusReportRow[]): TaskCorpusReportRow | null {
	return rows.find((row) => row.guidedTemplateId === templateId) ?? null
}

function buildPreset(starter: GuidedStarterTaskDefinition, rows: TaskCorpusReportRow[]): GuidedPresetRecommendation {
	const draft = buildGuidedStarterTaskDraft({ starterId: starter.id })
	const row = findCorpusRow(starter.templateId, rows)
	const evidenceSummary = row
		? `owner ${formatRate(row.ownerPassCount, row.ownerObserved)} | beta ${formatRate(row.betaPassCount, row.betaObserved)} | total ${formatRate(row.totalPassCount, row.totalObserved)}`
		: "no corpus evidence yet"

	return {
		starterId: starter.id,
		label: starter.label,
		description: starter.description,
		templateId: starter.templateId,
		sampleTaskText: draft.taskText || "(sample unavailable)",
		evidenceSummary,
		nextFocus: row?.nextFocus ?? "Collect the first artifact-backed observation for this preset.",
		recommended: row ? presetRecommended(row) : false,
		reason: row ? presetReason(row) : "No task-family evidence has been recorded for this preset yet.",
	}
}

export function buildGuidedPresetLibrary(
	rootDir = resolveRc1RootDir(__dirname),
	reportRows?: TaskCorpusReportRow[],
): GuidedPresetRecommendation[] {
	const rows = reportRows ?? buildTaskCorpusReport(rootDir).rows
	return GUIDED_TASK_LIBRARY_V2.map((starter) => buildPreset(starter, rows)).sort(sortKey)
}

export function findPresetForTemplate(
	templateId: GuidedTaskTemplateId | null,
	rootDir = resolveRc1RootDir(__dirname),
	reportRows?: TaskCorpusReportRow[],
): GuidedPresetRecommendation | null {
	if (!templateId) return null
	return buildGuidedPresetLibrary(rootDir, reportRows).find((preset) => preset.templateId === templateId) ?? null
}

export function formatGuidedPresetLibrary(
	rootDir = resolveRc1RootDir(__dirname),
	reportRows?: TaskCorpusReportRow[],
): string {
	const presets = buildGuidedPresetLibrary(rootDir, reportRows)
	return [
		"Recommended presets:",
		...presets.flatMap((preset) => [
			`- ${preset.label}${preset.recommended ? " [recommended]" : ""}`,
			`  sample: ${preset.sampleTaskText}`,
			`  evidence: ${preset.evidenceSummary}`,
			`  next focus: ${preset.nextFocus}`,
		]),
	].join("\n")
}
