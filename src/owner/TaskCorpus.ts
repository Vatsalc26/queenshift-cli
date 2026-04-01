import fs from "node:fs"
import path from "node:path"

import { buildHeadToHeadBenchmarkMatrix, type HeadToHeadBenchmarkMatrix } from "../benchmark/HeadToHeadBenchmark"
import { readDailyDriverLog, resolveRc1RootDir, type DailyDriverEntry } from "../release/Rc1Ops"
import {
	GUIDED_TASK_LIBRARY_V2,
	GUIDED_TASK_TEMPLATES,
	type GuidedStarterTaskId,
	type GuidedTaskTemplateId,
} from "../shell/GuidedTaskTemplates"
import {
	readReplayLearnedImprovementFromSummaryPath,
	type ReplayLearningSource,
} from "../run/ReplayLearning"
import { buildDemoGallery, type DemoGallery } from "./DemoGallery"
import { TASK_CORPUS_IDS, type TaskCorpusId } from "./TaskCorpusIds"
import { BETA_MATRIX_TASKS } from "../../verification/beta_matrix_tasks"
import { findLatestBetaSummary, type BetaRunSummary, type BetaRowResult } from "../../verification/verify_live_beta"
import { extractTaskFileRefs } from "../run/TaskContract"

export type TaskCorpusOutcome = "pass" | "review_required" | "failed" | "refused"
export type TaskCorpusSteeringLoad = "low" | "medium" | "high"
export type TaskCorpusCostEnvelope = "low" | "medium" | "high"

export type TaskCorpusCatalogEntry = {
	id: TaskCorpusId
	label: string
	lane: string
	summary: string
	scoutPlaybook: string[]
	reliabilitySignals: string[]
	guidedTemplateId: GuidedTaskTemplateId | null
	starterTaskId: GuidedStarterTaskId | null
	proofCommands: string[]
	steeringLoad: TaskCorpusSteeringLoad
	costEnvelope: TaskCorpusCostEnvelope
	baselineRationale: string
}

export type TaskCorpusStudyBaseline = {
	surfacesUsed: string[]
	topFriction: string[]
}

export type TaskCorpusObservation = {
	observationId: string
	corpusTaskId: TaskCorpusId | null
	source: "owner_daily_driver" | "beta_matrix"
	task: string
	outcome: TaskCorpusOutcome
	evidencePath: string | null
	observedAt: string | null
}

export type TaskCorpusAcceptedExample = {
	observationId: string
	source: "owner_daily_driver" | "beta_matrix"
	task: string
	evidencePath: string
	observedAt: string | null
	learningSource: ReplayLearningSource | null
	learningSummary: string | null
}

export type TaskCorpusSampleCoverage = {
	totalFamilies: number
	observedFamilies: number
	benchmarkCoveredFamilies: number
	benchmarkRowCount: number
	demoCoveredFamilies: number
	acceptedExampleFamilies: number
	uncoveredBenchmarkFamilies: TaskCorpusId[]
}

export type TaskCorpusReportRow = TaskCorpusCatalogEntry & {
	ownerObserved: number
	ownerPassCount: number
	ownerSuccessRate: number | null
	betaObserved: number
	betaPassCount: number
	betaSuccessRate: number | null
	totalObserved: number
	totalPassCount: number
	totalSuccessRate: number | null
	demoExampleIds: string[]
	benchmarkTaskIds: string[]
	betaTaskIds: string[]
	latestEvidencePath: string | null
	acceptedExampleCount: number
	acceptedExamples: TaskCorpusAcceptedExample[]
	replayLearningSummary: string
	nextFocus: string
}

export type TaskCorpusReport = {
	generatedAt: string
	catalogValidationIssues: string[]
	ownerEvidenceSource: string
	betaEvidenceSource: string
	strangerBaselineSource: string
	studyBaseline: TaskCorpusStudyBaseline
	ownerObservationCount: number
	betaObservationCount: number
	sampleCoverage: TaskCorpusSampleCoverage
	rows: TaskCorpusReportRow[]
	unmatchedOwnerTasks: string[]
	unmatchedBetaRows: string[]
}

type TaskCorpusBuildOptions = {
	generatedAt?: string
	dailyDriverEntries?: DailyDriverEntry[]
	betaSummary?: BetaRunSummary | null
	betaSummaryPath?: string | null
	strangerStudyText?: string
	demoGallery?: DemoGallery
	benchmarkMatrix?: HeadToHeadBenchmarkMatrix
}

const TASK_CORPUS_CATALOG: TaskCorpusCatalogEntry[] = [
	{
		id: "comment_file",
		label: "Single-file comment or clarification",
		lane: "small bounded",
		summary: "A tiny comment edit in one named file. Best first task for trust and low steering.",
		scoutPlaybook: [
			"Stay on the one named file only.",
			"Pull extra repo context only when the requested wording clearly depends on project conventions.",
			"On tier-2 large repos, keep scout context to stable docs plus one config or entry hint; do not widen through nearby siblings.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "comment_file",
		starterTaskId: "starter_add_comment",
		proofCommands: ["npm.cmd run verify:task-composer", "npm.cmd run verify:demo:run", "npm.cmd run verify:live:beta"],
		steeringLoad: "low",
		costEnvelope: "low",
		baselineRationale: "One named file, one tiny edit, and guided/demo surfaces make this the calmest default lane.",
	},
	{
		id: "create_tiny_file",
		label: "Create one tiny named file",
		lane: "small bounded",
		summary: "A one-file creation task with an explicit filename and small expected contents.",
		scoutPlaybook: [
			"Honor the exact filename first.",
			"Use one stable docs file only if the file purpose is unclear from the task text.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "create_tiny_file",
		starterTaskId: "starter_create_note",
		proofCommands: ["npm.cmd run verify:owner:task-library", "npm.cmd run verify:task:templates", "npm.cmd run verify:live:beta"],
		steeringLoad: "low",
		costEnvelope: "low",
		baselineRationale: "The file target and expected contents stay explicit, so this remains a cheap first-run task family.",
	},
	{
		id: "update_named_file",
		label: "Update one named file",
		lane: "small bounded",
		summary: "A focused update inside one explicit file, including safe config-file edits.",
		scoutPlaybook: [
			"Anchor on the named file.",
			"Carry at most one config or readme context file when behavior or config wording must stay aligned.",
			"On tier-2 large repos, prefer the repo-map discovery pack over local neighbor expansion.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "update_named_file",
		starterTaskId: "starter_update_named_file",
		proofCommands: ["npm.cmd run verify:task:templates", "npm.cmd run verify:live:beta"],
		steeringLoad: "low",
		costEnvelope: "low",
		baselineRationale: "Named-file scope plus starter guidance keep this lane inexpensive unless the repo profile itself fails.",
	},
	{
		id: "update_file_and_test",
		label: "Update one file and its test",
		lane: "semi-open helper-plus-test",
		summary: "A bounded semi-open lane that edits one named source file and its nearby test.",
		scoutPlaybook: [
			"Anchor on the named source file.",
			"Derive exactly one nearby test file.",
			"Carry one config or entry-point hint only if verification needs it.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "update_file_and_test",
		starterTaskId: "starter_update_with_test",
		proofCommands: ["npm.cmd run verify:task:templates", "npm.cmd run verify:lane:semiopen"],
		steeringLoad: "medium",
		costEnvelope: "medium",
		baselineRationale: "The source anchor stays explicit, but nearby test discovery and verification add real coordination overhead.",
	},
	{
		id: "sync_docs_with_source",
		label: "Sync docs with one source file",
		lane: "semi-open docs-sync",
		summary: "A bounded docs-sync lane anchored on one source file and one explicit docs target.",
		scoutPlaybook: [
			"Anchor on the named source file.",
			"Derive exactly one docs target from the task hint.",
			"Prefer knowledge-pack docs before repo-map fallback docs when wording context is needed.",
			"On tier-2 large repos, keep discovery to the named source, one docs target, and one stable guide only.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "sync_docs_with_source",
		starterTaskId: "starter_sync_docs",
		proofCommands: ["npm.cmd run verify:task:templates", "npm.cmd run verify:lane:semiopen", "npm.cmd run verify:live:beta"],
		steeringLoad: "medium",
		costEnvelope: "medium",
		baselineRationale: "Two anchored files keep it bounded, but the system still has to interpret source-to-doc drift correctly.",
	},
	{
		id: "rename_export",
		label: "Rename one export and direct call sites",
		lane: "semi-open rename",
		summary: "A rename lane anchored on one source file plus direct local call sites.",
		scoutPlaybook: [
			"Anchor on the named source file.",
			"Discover only direct local call sites.",
			"Stop if the importer set exceeds the bounded file cap.",
		],
		reliabilitySignals: [],
		guidedTemplateId: "rename_export",
		starterTaskId: "starter_rename_export",
		proofCommands: ["npm.cmd run verify:owner:task-library", "npm.cmd run verify:task-composer"],
		steeringLoad: "medium",
		costEnvelope: "medium",
		baselineRationale: "The rename target is explicit, but direct call-site discovery still makes this costlier than one-file tasks.",
	},
	{
		id: "sync_docs_bundle",
		label: "Sync a small docs bundle",
		lane: "bounded multi-file docs",
		summary: "A narrow docs-only bundle change across a tiny set of named docs files.",
		scoutPlaybook: [
			"Stay inside the named docs bundle.",
			"Use one stable repo guide only as wording context.",
			"Do not reopen code discovery for docs-only work.",
		],
		reliabilitySignals: [],
		guidedTemplateId: null,
		starterTaskId: null,
		proofCommands: ["npm.cmd run verify:live:beta"],
		steeringLoad: "medium",
		costEnvelope: "medium",
		baselineRationale: "The scope is named and docs-only, but it still asks for multi-file coordination without a starter preset.",
	},
	{
		id: "bounded_two_file_update",
		label: "Bounded two-file coordination",
		lane: "scoped coordination",
		summary: "An explicit two-file coordination lane with no hidden planner scope expansion.",
		scoutPlaybook: [
			"Keep the two named files as the only edit targets.",
			"Carry one repo config or entry-point context file when coordination needs it.",
			"Use replay and progress artifacts instead of widening discovery.",
		],
		reliabilitySignals: [],
		guidedTemplateId: null,
		starterTaskId: null,
		proofCommands: ["npm.cmd run verify:progress-map", "npm.cmd run verify:replay-export"],
		steeringLoad: "medium",
		costEnvelope: "medium",
		baselineRationale: "Two-file coordination is still bounded, but replay and progress artifacts make it heavier than starter lanes.",
	},
	{
		id: "medium_multi_file_update",
		label: "Explicit medium multi-file update",
		lane: "medium bounded",
		summary: "A named medium-file lane for richer swarm behavior without repo-wide discovery.",
		scoutPlaybook: [
			"Keep discovery bounded to the named 6-10 files.",
			"Carry one config plus one entry-point hint, not repo-wide exploration.",
			"Use scout handoff notes to preserve why each extra context file was included.",
			"On tier-2 large repos, use the reduced scout budget and skip nearby-neighbor or git-recency expansion.",
		],
		reliabilitySignals: [
			"Mode selector must stay explicit so medium work does not collapse back into vague heavy-complex routing.",
			"Critic review and targeted evaluators remain required because medium coordination should explain risk instead of hiding it.",
			"Checkpoint and retry snapshot artifacts must stay available so partial medium work can be resumed without guesswork.",
			"Repo-backed verification should pass before medium work counts as deeply proven rather than merely plausible.",
		],
		guidedTemplateId: null,
		starterTaskId: null,
		proofCommands: ["npm.cmd run verify:lane:medium", "npm.cmd run verify:profiles"],
		steeringLoad: "high",
		costEnvelope: "high",
		baselineRationale: "Explicit 6-10 file work is supported, but it needs deeper planning, verification, and review than calmer defaults.",
	},
	{
		id: "cross_language_sync",
		label: "Cross-language bounded sync",
		lane: "bounded multi-language",
		summary: "A small bounded task that crosses code, docs, and a second language in one explicit scope.",
		scoutPlaybook: [
			"Keep the cross-language file set explicit.",
			"Carry one shared docs or config anchor only if both languages depend on it.",
			"Prefer repo-map verification hints before adding more files.",
		],
		reliabilitySignals: [],
		guidedTemplateId: null,
		starterTaskId: null,
		proofCommands: ["npm.cmd run verify:profiles", "npm.cmd run verify:live:beta"],
		steeringLoad: "high",
		costEnvelope: "high",
		baselineRationale: "Cross-language coordination and mixed verification surfaces make this one of the highest-overhead bounded families.",
	},
]

function normalizePathForCompare(value: string): string {
	const resolved = path.resolve(value)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isSubPath(candidatePath: string, parentPath: string): boolean {
	const normalizedCandidate = normalizePathForCompare(candidatePath)
	const normalizedParent = normalizePathForCompare(parentPath)
	if (normalizedCandidate === normalizedParent) return true
	const relativePath = path.relative(normalizedParent, normalizedCandidate)
	return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

function percent(passCount: number, observed: number): number | null {
	if (observed <= 0) return null
	return Math.round((passCount / observed) * 1000) / 10
}

function formatRate(passCount: number, observed: number): string {
	if (observed <= 0) return "0/0"
	const rate = percent(passCount, observed)
	return `${passCount}/${observed} (${rate === null ? "n/a" : `${rate}%`})`
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractMarkdownList(text: string, heading: string): string[] {
	const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return []

	const sectionStart = headingMatch.index + headingMatch[0].length
	const remainder = text.slice(sectionStart)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	const section = nextHeadingIndex === -1 ? remainder : remainder.slice(0, nextHeadingIndex)

	return section
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter((line) => /^\d+\.\s/u.test(line))
		.map((line) => line.replace(/^\d+\.\s+/u, "").trim())
}

function extractLabeledList(text: string, label: string): string[] {
	const labelPattern = new RegExp(`^${escapeRegExp(label)}\\s*$`, "m")
	const labelMatch = labelPattern.exec(text)
	if (!labelMatch || typeof labelMatch.index !== "number") return []

	const sectionStart = labelMatch.index + labelMatch[0].length
	const remainder = text.slice(sectionStart)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	const section = nextHeadingIndex === -1 ? remainder : remainder.slice(0, nextHeadingIndex)

	return section
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter((line) => /^\d+\.\s/u.test(line))
		.map((line) => line.replace(/^\d+\.\s+/u, "").trim())
}

function readStrangerStudyBaseline(rootDir: string, providedText?: string): { source: string; baseline: TaskCorpusStudyBaseline } {
	const studyPath = path.join(rootDir, "STRANGER_FIRST_RUN_STUDY.md")
	const text = typeof providedText === "string" ? providedText : fs.existsSync(studyPath) ? fs.readFileSync(studyPath, "utf8") : ""

	return {
		source: typeof providedText === "string" ? "provided study text" : fs.existsSync(studyPath) ? "STRANGER_FIRST_RUN_STUDY.md" : "missing",
		baseline: {
			surfacesUsed: extractLabeledList(text, "Surfaces used:"),
			topFriction: extractMarkdownList(text, "Top Friction Found"),
		},
	}
}

function isOwnerPracticeEntry(rootDir: string, entry: DailyDriverEntry): boolean {
	if (!entry.task.trim()) return false
	if (!entry.workspace.trim()) return false

	const workspace = path.resolve(entry.workspace)
	const verificationDir = path.join(rootDir, "verification")
	const betaWorkspaceDir = path.join(rootDir, ".swarm", "beta_workspaces")
	const semiopenWorkspaceDir = path.join(rootDir, ".swarm", "semiopen_workspaces")
	const surface = entry.surface.trim().toLowerCase()

	if (surface === "owner_smoke" || surface === "owner_guided_demo" || surface === "demo_repo_pack") {
		return false
	}

	return (
		!isSubPath(workspace, verificationDir) &&
		!isSubPath(workspace, betaWorkspaceDir) &&
		!isSubPath(workspace, semiopenWorkspaceDir)
	)
}

function isSuccessfulOwnerEntry(entry: DailyDriverEntry): boolean {
	return (
		entry.terminalStatus === "done" &&
		entry.reviewerVerdict === "PASS" &&
		entry.acceptanceGate === "passed" &&
		entry.manualRepair === false &&
		(entry.verificationProfile === "passed" || entry.verificationProfile === "not_applicable")
	)
}

export function classifyTaskTextToCorpusId(taskText: string): TaskCorpusId | null {
	const task = taskText.trim().toLowerCase()
	const explicitFiles = extractTaskFileRefs(taskText)
	if (!task) return null
	if (task.includes("scripts/report.py") || task.includes("docs/notes.md")) return "cross_language_sync"
	if (task.includes("update hello.ts and utils.ts together")) return "bounded_two_file_update"
	if (explicitFiles.length === 2 && /\bupdate\b/u.test(task) && /\btogether\b/u.test(task)) return "bounded_two_file_update"
	if (explicitFiles.length >= 6 && explicitFiles.length <= 10) return "medium_multi_file_update"
	if (task.includes("package.json") && task.includes("guide.md") && task.includes("extra.ts")) return "medium_multi_file_update"
	if (task.includes("readme.md") && task.includes("docs/faq.md")) return "sync_docs_bundle"
	if (task.includes("keep its test aligned")) return "update_file_and_test"
	if (
		task.startsWith("rename ") &&
		(task.includes("call site") ||
			task.includes("callsites") ||
			task.includes("import ") ||
			task.includes("imports") ||
			task.includes("importer") ||
			task.includes("reference"))
	) {
		return "rename_export"
	}
	if (
		task.startsWith("sync the repo-root readme") ||
		task.startsWith("sync the guide docs") ||
		task.startsWith("sync the faq docs") ||
		task.startsWith("sync the docs")
	) {
		return "sync_docs_with_source"
	}
	if (task.startsWith("create ")) return "create_tiny_file"
	if (task.includes("comment")) return "comment_file"
	if (task.startsWith("update ")) return "update_named_file"
	return null
}

function ownerObservationOutcome(entry: DailyDriverEntry): TaskCorpusOutcome {
	if (entry.terminalStatus === "review_required") return "review_required"
	return isSuccessfulOwnerEntry(entry) ? "pass" : "failed"
}

function betaObservationOutcome(row: BetaRowResult): TaskCorpusOutcome {
	switch (row.verdict) {
		case "pass":
			return "pass"
		case "review_required":
			return "review_required"
		case "refused":
			return "refused"
		case "failed":
		default:
			return "failed"
	}
}

function latestEvidencePath(observations: TaskCorpusObservation[]): string | null {
	const evidence = observations.find((observation) => observation.evidencePath)
	return evidence?.evidencePath ?? null
}

function compareObservedAtDescending(left: TaskCorpusObservation, right: TaskCorpusObservation): number {
	const leftAt = left.observedAt ?? ""
	const rightAt = right.observedAt ?? ""
	return rightAt.localeCompare(leftAt) || left.observationId.localeCompare(right.observationId)
}

function buildAcceptedExamples(observations: TaskCorpusObservation[], maxExamples = 2): TaskCorpusAcceptedExample[] {
	return observations
		.filter((observation) => observation.outcome === "pass" && observation.evidencePath)
		.sort(compareObservedAtDescending)
		.slice(0, Math.max(1, maxExamples))
		.map((observation) => {
			const learning = readReplayLearnedImprovementFromSummaryPath(observation.evidencePath)
			return {
				observationId: observation.observationId,
				source: observation.source,
				task: observation.task,
				evidencePath: observation.evidencePath ?? "",
				observedAt: observation.observedAt,
				learningSource: learning?.eligible ? learning.source : null,
				learningSummary: learning?.eligible ? learning.lessons[0] ?? learning.summary : null,
			}
		})
}

function buildReplayLearningSummary(examples: TaskCorpusAcceptedExample[]): string {
	if (examples.length === 0) {
		return "No accepted example artifacts are ready for replay learning yet."
	}
	const replayBacked = examples.filter((example) => example.learningSummary && example.learningSource)
	const latest = replayBacked[0]
	if (latest) {
		return `Accepted replay examples: ${examples.length}; latest lesson (${latest.learningSource}): ${latest.learningSummary}`
	}
	return "Accepted example artifacts exist for this task family; replay those examples before widening the lane."
}

function buildNextFocus(row: TaskCorpusReportRow): string {
	if (row.totalObserved === 0) {
		if (row.demoExampleIds.length > 0 || row.benchmarkTaskIds.length > 0) {
			return "Collect the first artifact-backed observation for this task family."
		}
		return "Catalog only; keep the lane documented until real evidence arrives."
	}
	if ((row.totalSuccessRate ?? 100) < 60) {
		return "Reduce failures before widening or promoting this task family."
	}
	if (row.ownerObserved === 0 && row.betaObserved > 0) {
		return "Collect real owner evidence before making the task a default starter."
	}
	if (row.ownerObserved > 0 && row.totalSuccessRate !== null && row.totalSuccessRate >= 80 && row.guidedTemplateId) {
		return "Good candidate for calmer presets and lower-steering entry points."
	}
	if (row.betaObserved === 0 && row.benchmarkTaskIds.length > 0) {
		return "Link a beta or benchmark observation before comparing this lane more broadly."
	}
	return "Keep monitoring; this task family already has usable evidence."
}

export function buildTaskCorpusCatalog(): TaskCorpusCatalogEntry[] {
	return TASK_CORPUS_CATALOG.map((entry) => ({
		...entry,
		scoutPlaybook: [...entry.scoutPlaybook],
		reliabilitySignals: [...entry.reliabilitySignals],
		proofCommands: [...entry.proofCommands],
	}))
}

export function validateTaskCorpusCatalog(
	rootDir = resolveRc1RootDir(__dirname),
	options: { demoGallery?: DemoGallery; benchmarkMatrix?: HeadToHeadBenchmarkMatrix } = {},
): string[] {
	const issues: string[] = []
	const catalog = buildTaskCorpusCatalog()
	const demoGallery = options.demoGallery ?? buildDemoGallery(rootDir)
	const benchmarkMatrix = options.benchmarkMatrix ?? buildHeadToHeadBenchmarkMatrix()
	const entryById = new Map<TaskCorpusId, TaskCorpusCatalogEntry>()
	const templateIds = new Set(GUIDED_TASK_TEMPLATES.map((template) => template.id))
	const starterIds = new Set(GUIDED_TASK_LIBRARY_V2.map((starter) => starter.id))
	const knownIds = new Set<TaskCorpusId>(TASK_CORPUS_IDS)

	for (const entry of catalog) {
		if (!knownIds.has(entry.id)) issues.push(`Unknown corpus id: ${entry.id}`)
		if (entryById.has(entry.id)) issues.push(`Duplicate corpus id: ${entry.id}`)
		entryById.set(entry.id, entry)
		if (entry.guidedTemplateId && !templateIds.has(entry.guidedTemplateId)) {
			issues.push(`Unknown guided template for ${entry.id}: ${entry.guidedTemplateId}`)
		}
		if (entry.starterTaskId && !starterIds.has(entry.starterTaskId)) {
			issues.push(`Unknown starter task for ${entry.id}: ${entry.starterTaskId}`)
		}
		if (entry.proofCommands.length === 0) {
			issues.push(`Corpus entry ${entry.id} must list at least one proof command.`)
		}
		if (entry.scoutPlaybook.length === 0) {
			issues.push(`Corpus entry ${entry.id} must define a scout playbook.`)
		}
		if (entry.id === "medium_multi_file_update" && entry.reliabilitySignals.length === 0) {
			issues.push("Corpus entry medium_multi_file_update must define reliability signals.")
		}
	}

	for (const example of demoGallery.examples) {
		if (!entryById.has(example.corpusTaskId)) {
			issues.push(`Demo gallery example ${example.id} points at missing corpus id ${example.corpusTaskId}.`)
		}
	}

	for (const task of benchmarkMatrix.tasks) {
		if (!entryById.has(task.corpusTaskId)) {
			issues.push(`Benchmark task ${task.id} points at missing corpus id ${task.corpusTaskId}.`)
		}
	}

	for (const row of BETA_MATRIX_TASKS) {
		if (!entryById.has(row.corpusTaskId)) {
			issues.push(`Beta row ${row.id} points at missing corpus id ${row.corpusTaskId}.`)
		}
	}

	return issues
}

export function buildTaskCorpusReport(
	rootDir = resolveRc1RootDir(__dirname),
	options: TaskCorpusBuildOptions = {},
): TaskCorpusReport {
	const generatedAt = options.generatedAt ?? new Date().toISOString()
	const catalog = buildTaskCorpusCatalog()
	const demoGallery = options.demoGallery ?? buildDemoGallery(rootDir)
	const benchmarkMatrix = options.benchmarkMatrix ?? buildHeadToHeadBenchmarkMatrix()
	const catalogValidationIssues = validateTaskCorpusCatalog(rootDir, { demoGallery, benchmarkMatrix })

	const dailyDriverReadResult = options.dailyDriverEntries
		? { source: "provided daily-driver entries", entries: options.dailyDriverEntries }
		: (() => {
				const readResult = readDailyDriverLog(rootDir)
				return {
					source: readResult.parseError ? readResult.parseError : "RC1_DAILY_DRIVER_LOG.json",
					entries: readResult.log?.entries ?? [],
				}
			})()
	const betaSummaryPath =
		options.betaSummaryPath !== undefined ? options.betaSummaryPath : options.betaSummary ? "provided beta summary" : findLatestBetaSummary(rootDir)
	const betaSummary =
		options.betaSummary !== undefined
			? options.betaSummary
			: betaSummaryPath && betaSummaryPath !== "provided beta summary" && fs.existsSync(betaSummaryPath)
				? (JSON.parse(fs.readFileSync(betaSummaryPath, "utf8")) as BetaRunSummary)
				: null
	const strangerStudy = readStrangerStudyBaseline(rootDir, options.strangerStudyText)

	const ownerObservations: TaskCorpusObservation[] = []
	const unmatchedOwnerTasks: string[] = []

	for (const entry of dailyDriverReadResult.entries) {
		if (!isOwnerPracticeEntry(rootDir, entry)) continue
		const corpusTaskId = classifyTaskTextToCorpusId(entry.task)
		if (!corpusTaskId) {
			unmatchedOwnerTasks.push(entry.task)
		}
		ownerObservations.push({
			observationId: entry.runId,
			corpusTaskId,
			source: "owner_daily_driver",
			task: entry.task,
			outcome: ownerObservationOutcome(entry),
			evidencePath: entry.summaryPath ?? null,
			observedAt: entry.endedAt ?? entry.recordedAt ?? null,
		})
	}

	const betaObservations: TaskCorpusObservation[] = []
	const unmatchedBetaRows: string[] = []
	for (const row of betaSummary?.results ?? []) {
		const corpusTaskId = row.corpusTaskId ?? null
		if (!corpusTaskId) {
			unmatchedBetaRows.push(row.id)
		}
		betaObservations.push({
			observationId: row.id,
			corpusTaskId,
			source: "beta_matrix",
			task: row.task,
			outcome: betaObservationOutcome(row),
			evidencePath: row.summaryPath ?? row.artifactDir,
			observedAt: betaSummary?.generatedAt ?? null,
		})
	}

	const rows = catalog.map<TaskCorpusReportRow>((entry) => {
		const ownerRows = ownerObservations.filter((observation) => observation.corpusTaskId === entry.id)
		const betaRows = betaObservations.filter((observation) => observation.corpusTaskId === entry.id)
		const allRows = [...ownerRows, ...betaRows]
		const ownerPassCount = ownerRows.filter((observation) => observation.outcome === "pass").length
		const betaPassCount = betaRows.filter((observation) => observation.outcome === "pass").length
		const totalPassCount = ownerPassCount + betaPassCount
		const demoExampleIds = demoGallery.examples.filter((example) => example.corpusTaskId === entry.id).map((example) => example.id)
		const benchmarkTaskIds = benchmarkMatrix.tasks.filter((task) => task.corpusTaskId === entry.id).map((task) => task.id)
		const betaTaskIds = BETA_MATRIX_TASKS.filter((task) => task.corpusTaskId === entry.id).map((task) => task.id)
		const acceptedExamples = buildAcceptedExamples(allRows)

		const row: TaskCorpusReportRow = {
			...entry,
			ownerObserved: ownerRows.length,
			ownerPassCount,
			ownerSuccessRate: percent(ownerPassCount, ownerRows.length),
			betaObserved: betaRows.length,
			betaPassCount,
			betaSuccessRate: percent(betaPassCount, betaRows.length),
			totalObserved: allRows.length,
			totalPassCount,
			totalSuccessRate: percent(totalPassCount, allRows.length),
			demoExampleIds,
			benchmarkTaskIds,
			betaTaskIds,
			latestEvidencePath: latestEvidencePath([...betaRows, ...ownerRows]),
			acceptedExampleCount: acceptedExamples.length,
			acceptedExamples,
			replayLearningSummary: buildReplayLearningSummary(acceptedExamples),
			nextFocus: "",
		}
		row.nextFocus = buildNextFocus(row)
		return row
	})

	rows.sort((left, right) => {
		if (right.totalObserved !== left.totalObserved) return right.totalObserved - left.totalObserved
		if (right.betaObserved !== left.betaObserved) return right.betaObserved - left.betaObserved
		return left.label.localeCompare(right.label)
	})

	const sampleCoverage: TaskCorpusSampleCoverage = {
		totalFamilies: rows.length,
		observedFamilies: rows.filter((row) => row.totalObserved > 0).length,
		benchmarkCoveredFamilies: rows.filter((row) => row.benchmarkTaskIds.length > 0).length,
		benchmarkRowCount: rows.reduce((sum, row) => sum + row.benchmarkTaskIds.length, 0),
		demoCoveredFamilies: rows.filter((row) => row.demoExampleIds.length > 0).length,
		acceptedExampleFamilies: rows.filter((row) => row.acceptedExampleCount > 0).length,
		uncoveredBenchmarkFamilies: rows.filter((row) => row.benchmarkTaskIds.length === 0).map((row) => row.id),
	}

	return {
		generatedAt,
		catalogValidationIssues,
		ownerEvidenceSource: dailyDriverReadResult.source,
		betaEvidenceSource: betaSummaryPath ?? "missing",
		strangerBaselineSource: strangerStudy.source,
		studyBaseline: strangerStudy.baseline,
		ownerObservationCount: ownerObservations.length,
		betaObservationCount: betaObservations.length,
		sampleCoverage,
		rows,
		unmatchedOwnerTasks: Array.from(new Set(unmatchedOwnerTasks)).sort((left, right) => left.localeCompare(right)),
		unmatchedBetaRows: Array.from(new Set(unmatchedBetaRows)).sort((left, right) => left.localeCompare(right)),
	}
}

export function formatTaskCorpusReport(report: TaskCorpusReport): string {
	const lines = [
		"Task corpus and success matrix",
		`Generated at: ${report.generatedAt}`,
		`Owner evidence: ${report.ownerEvidenceSource} (${report.ownerObservationCount} observed owner task(s))`,
		`Beta evidence: ${report.betaEvidenceSource} (${report.betaObservationCount} observed beta row(s))`,
		`Stranger baseline: ${report.strangerBaselineSource}`,
	]

	if (report.catalogValidationIssues.length === 0) {
		lines.push("Catalog validation: PASS")
	} else {
		lines.push("Catalog validation: FAIL")
		lines.push(...report.catalogValidationIssues.map((issue) => `- ${issue}`))
	}

	if (report.studyBaseline.surfacesUsed.length > 0) {
		lines.push("")
		lines.push("Stranger baseline surfaces:")
		lines.push(...report.studyBaseline.surfacesUsed.map((surface) => `- ${surface}`))
	}

	if (report.studyBaseline.topFriction.length > 0) {
		lines.push("")
		lines.push("Top stranger friction:")
		lines.push(...report.studyBaseline.topFriction.map((friction) => `- ${friction}`))
	}

	lines.push("")
	lines.push("Structured sample coverage:")
	lines.push(`- Task families: ${report.sampleCoverage.totalFamilies}`)
	lines.push(`- Observed task families: ${report.sampleCoverage.observedFamilies}/${report.sampleCoverage.totalFamilies}`)
	lines.push(
		`- Benchmark-covered families: ${report.sampleCoverage.benchmarkCoveredFamilies}/${report.sampleCoverage.totalFamilies}`,
	)
	lines.push(`- Fixed benchmark rows: ${report.sampleCoverage.benchmarkRowCount}`)
	lines.push(`- Demo-linked families: ${report.sampleCoverage.demoCoveredFamilies}/${report.sampleCoverage.totalFamilies}`)
	lines.push(
		`- Families with accepted examples: ${report.sampleCoverage.acceptedExampleFamilies}/${report.sampleCoverage.totalFamilies}`,
	)
	lines.push(
		`- Benchmark gaps: ${report.sampleCoverage.uncoveredBenchmarkFamilies.join(", ") || "(none)"}`,
	)

	lines.push("")
	lines.push("Steering and cost baseline:")
	lines.push("Task family | Steering | Cost envelope | Why")
	lines.push("--- | --- | --- | ---")
	for (const row of report.rows) {
		lines.push(`${row.id} | ${row.steeringLoad} | ${row.costEnvelope} | ${row.baselineRationale}`)
	}

	lines.push("")
	lines.push("Task family | Owner | Beta | Total | Demo | Benchmark | Accepted | Next focus")
	lines.push("--- | --- | --- | --- | --- | --- | --- | ---")
	for (const row of report.rows) {
		lines.push(
			`${row.id} | ${formatRate(row.ownerPassCount, row.ownerObserved)} | ${formatRate(row.betaPassCount, row.betaObserved)} | ${formatRate(row.totalPassCount, row.totalObserved)} | ${row.demoExampleIds.length} | ${row.benchmarkTaskIds.length} | ${row.acceptedExampleCount} | ${row.nextFocus}`,
		)
	}

	lines.push("")
	lines.push("Task family details:")
	for (const row of report.rows) {
		lines.push(`- ${row.id}: ${row.label}`)
		lines.push(`  Lane: ${row.lane}`)
		lines.push(`  Summary: ${row.summary}`)
		lines.push(`  Scout playbook: ${row.scoutPlaybook.join(" | ")}`)
		lines.push(`  Reliability signals: ${row.reliabilitySignals.join(" | ") || "(none)"}`)
		lines.push(`  Steering baseline: ${row.steeringLoad}`)
		lines.push(`  Cost envelope: ${row.costEnvelope}`)
		lines.push(`  Baseline rationale: ${row.baselineRationale}`)
		lines.push(`  Guided template: ${row.guidedTemplateId ?? "(none)"}`)
		lines.push(`  Starter task: ${row.starterTaskId ?? "(none)"}`)
		lines.push(`  Demo examples: ${row.demoExampleIds.join(", ") || "(none)"}`)
		lines.push(`  Benchmark rows: ${row.benchmarkTaskIds.join(", ") || "(none)"}`)
		lines.push(`  Beta rows: ${row.betaTaskIds.join(", ") || "(none)"}`)
		lines.push(`  Latest evidence: ${row.latestEvidencePath ?? "(none yet)"}`)
		lines.push(`  Replay learning: ${row.replayLearningSummary}`)
		lines.push(
			`  Accepted examples: ${row.acceptedExamples.map((example) => `${example.source}:${example.observationId}`).join(", ") || "(none)"}`,
		)
		lines.push(`  Proof commands: ${row.proofCommands.join(" | ")}`)
	}

	if (report.unmatchedOwnerTasks.length > 0) {
		lines.push("")
		lines.push("Unmatched owner tasks:")
		lines.push(...report.unmatchedOwnerTasks.map((task) => `- ${task}`))
	}

	if (report.unmatchedBetaRows.length > 0) {
		lines.push("")
		lines.push("Unmatched beta rows:")
		lines.push(...report.unmatchedBetaRows.map((rowId) => `- ${rowId}`))
	}

	return lines.join("\n")
}
