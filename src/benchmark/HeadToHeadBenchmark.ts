import fs from "node:fs"
import path from "node:path"

import { TASK_CORPUS_IDS, type TaskCorpusId } from "../owner/TaskCorpusIds"

export const HEAD_TO_HEAD_BENCHMARK_VERSION = "head_to_head_v1"
export const HEAD_TO_HEAD_STUDY_RELATIVE_PATH = path.join("benchmarks", "head_to_head.study.json")
export const HEAD_TO_HEAD_STUDY_TEMPLATE_RELATIVE_PATH = path.join("benchmarks", "head_to_head.study.template.json")

export type BenchmarkToolId = "swarmcoder_v2" | "roo_code" | "cline"
export type BenchmarkOutcome = "pass" | "partial" | "fail" | "unsupported" | "not_run"
export type BenchmarkSteeringLoad = "low" | "medium" | "high" | "unknown"
export type BenchmarkScopeControl = "tight" | "mixed" | "loose" | "unknown"
export type BenchmarkArtifactClarity = "artifact_first" | "partial" | "opaque" | "unknown"

export type HeadToHeadBenchmarkTool = {
	id: BenchmarkToolId
	label: string
	evidenceMode: "artifact_backed_local_cli" | "manual_operator_study"
	notes: string[]
}

export type HeadToHeadBenchmarkTask = {
	id: string
	corpusTaskId: TaskCorpusId
	title: string
	lane: string
	workspaceFixture: string
	taskText: string
	compareWhat: string[]
	proofLinks: string[]
	notes: string[]
}

export type HeadToHeadBenchmarkMatrix = {
	schemaVersion: 1
	matrixVersion: string
	tools: HeadToHeadBenchmarkTool[]
	tasks: HeadToHeadBenchmarkTask[]
	rules: string[]
}

export type HeadToHeadStudyObservation = {
	toolId: BenchmarkToolId
	taskId: string
	outcome: BenchmarkOutcome
	steeringLoad: BenchmarkSteeringLoad
	scopeControl: BenchmarkScopeControl
	artifactClarity: BenchmarkArtifactClarity
	runtimeMinutes: number | null
	date: string | null
	notes: string
	evidence: string[]
}

export type HeadToHeadStudy = {
	schemaVersion: 1
	matrixVersion: string
	notes: string[]
	observations: HeadToHeadStudyObservation[]
}

export type HeadToHeadBenchmarkRow = {
	task: HeadToHeadBenchmarkTask
	results: Array<{
		tool: HeadToHeadBenchmarkTool
		observation: HeadToHeadStudyObservation
	}>
}

export type HeadToHeadBenchmarkToolSummary = {
	toolId: BenchmarkToolId
	toolLabel: string
	passCount: number
	partialCount: number
	failCount: number
	unsupportedCount: number
	notRunCount: number
}

export type HeadToHeadBenchmarkCoverage = {
	rowCount: number
	totalTaskFamilies: number
	coveredTaskFamilies: number
	uncoveredTaskFamilies: TaskCorpusId[]
}

export type HeadToHeadBenchmarkReport = {
	matrix: HeadToHeadBenchmarkMatrix
	study: HeadToHeadStudy
	studySource: string
	summaryByTool: HeadToHeadBenchmarkToolSummary[]
	coverage: HeadToHeadBenchmarkCoverage
	rows: HeadToHeadBenchmarkRow[]
}

const TOOLS: HeadToHeadBenchmarkTool[] = [
	{
		id: "swarmcoder_v2",
		label: "SwarmCoder V2",
		evidenceMode: "artifact_backed_local_cli",
		notes: [
			"Uses the shipped CLI, local artifacts, and existing proof surfaces in this repo.",
			"Do not change runtime behavior just to improve benchmark rows.",
		],
	},
	{
		id: "roo_code",
		label: "Roo Code",
		evidenceMode: "manual_operator_study",
		notes: [
			"Record same-day operator observations for the exact fixed tasks below.",
			"Leave rows as not_run if the tool is unavailable or the task is out of scope.",
		],
	},
	{
		id: "cline",
		label: "Cline",
		evidenceMode: "manual_operator_study",
		notes: [
			"Use the same repo fixture, task text, and observation fields as the other tools.",
			"Do not infer results from marketing claims or unrelated demos.",
		],
	},
]

const TASKS: HeadToHeadBenchmarkTask[] = [
	{
		id: "demo_pack_comment",
		corpusTaskId: "comment_file",
		title: "Disposable demo comment",
		lane: "small live demo",
		workspaceFixture: "verification/demo_repo_pack",
		taskText: "add a brief one-line comment to hello.ts describing greet",
		compareWhat: ["time to first useful result", "scope control", "artifact clarity"],
		proofLinks: ["npm.cmd run demo:run", "npm.cmd run verify:demo:run", "npm.cmd run task-corpus:report"],
		notes: ["Use the disposable demo pack path rather than a broad real-repo benchmark."],
	},
	{
		id: "guided_note_file",
		corpusTaskId: "create_tiny_file",
		title: "Guided note creation",
		lane: "small guided owner path",
		workspaceFixture: "verification/demo_repo_pack",
		taskText: "create notes.md with one sentence describing this repo",
		compareWhat: ["task-entry friction", "steering load", "scope trust"],
		proofLinks: ["npm.cmd run verify:task-composer", "npm.cmd run verify:owner:task-library", "npm.cmd run task-corpus:report"],
		notes: ["Use the exact task text above even if another tool prefers a different prompt style."],
	},
	{
		id: "semiopen_helper_test_sync",
		corpusTaskId: "update_file_and_test",
		title: "Anchored helper/test sync",
		lane: "semi-open helper-test",
		workspaceFixture: "verification/beta_repo_templates/ts_cli_tool",
		taskText: "update src/format.ts and keep its test aligned",
		compareWhat: ["anchored discovery quality", "changed-file discipline", "review clarity"],
		proofLinks: ["npm.cmd run verify:semiopen", "npm.cmd run verify:lane:semiopen", "npm.cmd run task-corpus:report"],
		notes: ["Refuse or mark unsupported rather than widening the task into a repo-wide refactor."],
	},
	{
		id: "semiopen_docs_sync",
		corpusTaskId: "sync_docs_with_source",
		title: "Anchored docs sync",
		lane: "semi-open docs-sync",
		workspaceFixture: "verification/beta_repo_templates/docs_playbook",
		taskText: "sync docs/guide.md with src/config.ts",
		compareWhat: ["anchored docs discovery", "scope control", "follow-up clarity"],
		proofLinks: ["npm.cmd run verify:semiopen", "npm.cmd run verify:incident", "npm.cmd run task-corpus:report"],
		notes: ["Keep the benchmark on the named docs target instead of drifting into unrelated docs cleanup."],
	},
	{
		id: "rename_export_direct_calls",
		corpusTaskId: "rename_export",
		title: "Anchored rename with direct call sites",
		lane: "semi-open rename",
		workspaceFixture: "verification/beta_repo_templates/ts_cli_tool",
		taskText: "rename the export in src/format.ts to formatValue and update its direct call sites",
		compareWhat: ["rename safety", "direct-call scope control", "review clarity"],
		proofLinks: ["npm.cmd run verify:semiopen", "npm.cmd run verify:task-composer", "npm.cmd run task-corpus:report"],
		notes: ["Keep the benchmark on the anchored export rename instead of widening it into a broader refactor."],
	},
	{
		id: "docs_bundle_readme_faq_sync",
		corpusTaskId: "sync_docs_bundle",
		title: "Bounded docs-bundle sync",
		lane: "bounded multi-file docs",
		workspaceFixture: "verification/beta_repo_templates/docs_playbook",
		taskText: "update README.md and docs/faq.md together",
		compareWhat: ["multi-doc scope control", "docs consistency", "artifact clarity"],
		proofLinks: ["npm.cmd run verify:live:beta", "npm.cmd run benchmark:head-to-head", "npm.cmd run task-corpus:report"],
		notes: ["Keep this row docs-only and explicit instead of converting it into code discovery."],
	},
	{
		id: "explicit_config_file_update",
		corpusTaskId: "update_named_file",
		title: "Explicit config-file update",
		lane: "explicit bounded config edit",
		workspaceFixture: "verification/beta_repo_templates/config_service",
		taskText: "update config/defaults.json to enable beta mode",
		compareWhat: ["explicit scope handling", "config-file safety", "task clarity"],
		proofLinks: ["npm.cmd run verify:semiopen", "npm.cmd run verify:live:beta", "npm.cmd run task-corpus:report"],
		notes: ["This row stays explicit; do not convert it into a broader config-sync discovery task."],
	},
	{
		id: "scoped_two_file_update",
		corpusTaskId: "bounded_two_file_update",
		title: "Bounded two-file coordination",
		lane: "scoped multi-file",
		workspaceFixture: "verification/dogfood_repo_copy_final",
		taskText: "update utils.ts and hello.ts together",
		compareWhat: ["bounded coordination", "scope control", "artifact transparency"],
		proofLinks: ["npm.cmd run verify:progress-map", "npm.cmd run verify:replay-export", "npm.cmd run task-corpus:report"],
		notes: ["Treat this as an explicit two-file task, not a free-form planner benchmark."],
	},
	{
		id: "explicit_medium_six_file_sync",
		corpusTaskId: "medium_multi_file_update",
		title: "Explicit medium six-file coordination",
		lane: "medium bounded",
		workspaceFixture: "verification/beta_repo_templates/ts_cli_tool",
		taskText: "update package.json, README.md, scripts/verify.js, src/format.ts, src/format.test.ts, and src/index.ts together",
		compareWhat: ["medium-lane planning clarity", "verification fit", "reviewable scope control"],
		proofLinks: ["npm.cmd run verify:lane:medium", "npm.cmd run verify:profiles", "npm.cmd run task-corpus:report"],
		notes: ["Use this row to compare explicit 6-file coordination, not open-ended planner discovery."],
	},
	{
		id: "cross_language_reporter_sync",
		corpusTaskId: "cross_language_sync",
		title: "Bounded cross-language reporter sync",
		lane: "bounded cross-language",
		workspaceFixture: "verification/beta_repo_templates/mixed_reporter",
		taskText: "update src/main.ts, docs/notes.md, scripts/report.py, and README.md together",
		compareWhat: ["cross-language scope control", "mixed-surface accuracy", "artifact clarity"],
		proofLinks: ["npm.cmd run verify:profiles", "npm.cmd run verify:live:beta", "npm.cmd run task-corpus:report"],
		notes: ["Keep the task explicit across code, docs, and Python instead of letting it drift into a repo-wide cleanup."],
	},
]

const RULES = [
	"Use the exact fixed task text and repo fixture listed in the matrix. Do not rewrite rows per tool.",
	"Record same-day observations on the same machine when possible; otherwise keep the row as not_run.",
	"Benchmark only the supported repo classes and bounded lanes already claimed by V2.",
	"Capture evidence references for every observed row: artifact path, replay path, screenshot, or operator notes path.",
	"Do not change V2 runtime behavior just to improve benchmark outcomes.",
	"Do not turn blank or not_run competitor rows into marketing claims.",
]

const VALID_OUTCOMES = new Set<BenchmarkOutcome>(["pass", "partial", "fail", "unsupported", "not_run"])
const VALID_STEERING_LOADS = new Set<BenchmarkSteeringLoad>(["low", "medium", "high", "unknown"])
const VALID_SCOPE_CONTROLS = new Set<BenchmarkScopeControl>(["tight", "mixed", "loose", "unknown"])
const VALID_ARTIFACT_CLARITY = new Set<BenchmarkArtifactClarity>(["artifact_first", "partial", "opaque", "unknown"])

function asStringArray(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		throw new Error(`Invalid ${fieldName}: expected a string[]`)
	}
	return value as string[]
}

function formatStudySource(rootDir: string, studyPath: string): string {
	const relative = path.relative(rootDir, studyPath)
	return relative && !relative.startsWith("..") ? relative : studyPath
}

function formatToolMode(tool: HeadToHeadBenchmarkTool): string {
	return tool.evidenceMode === "artifact_backed_local_cli" ? "artifact-backed local CLI" : "manual operator study"
}

function formatOutcome(value: BenchmarkOutcome): string {
	switch (value) {
		case "pass":
			return "PASS"
		case "partial":
			return "PARTIAL"
		case "fail":
			return "FAIL"
		case "unsupported":
			return "UNSUPPORTED"
		case "not_run":
		default:
			return "NOT RUN"
	}
}

function defaultObservation(toolId: BenchmarkToolId, taskId: string): HeadToHeadStudyObservation {
	return {
		toolId,
		taskId,
		outcome: "not_run",
		steeringLoad: "unknown",
		scopeControl: "unknown",
		artifactClarity: "unknown",
		runtimeMinutes: null,
		date: null,
		notes: "",
		evidence: [],
	}
}

function validateObservation(
	observation: unknown,
	knownToolIds: Set<BenchmarkToolId>,
	knownTaskIds: Set<string>,
): HeadToHeadStudyObservation {
	if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
		throw new Error("Invalid study observation: expected an object")
	}

	const record = observation as Record<string, unknown>
	const toolId = record["toolId"]
	const taskId = record["taskId"]
	const outcome = record["outcome"]
	const steeringLoad = record["steeringLoad"]
	const scopeControl = record["scopeControl"]
	const artifactClarity = record["artifactClarity"]
	const runtimeMinutes = record["runtimeMinutes"]
	const date = record["date"]
	const notes = record["notes"]
	const evidence = record["evidence"]

	if (typeof toolId !== "string" || !knownToolIds.has(toolId as BenchmarkToolId)) {
		throw new Error(`Invalid study observation toolId: ${String(toolId)}`)
	}
	if (typeof taskId !== "string" || !knownTaskIds.has(taskId)) {
		throw new Error(`Invalid study observation taskId: ${String(taskId)}`)
	}
	if (typeof outcome !== "string" || !VALID_OUTCOMES.has(outcome as BenchmarkOutcome)) {
		throw new Error(`Invalid study observation outcome for ${toolId}/${taskId}: ${String(outcome)}`)
	}
	if (typeof steeringLoad !== "string" || !VALID_STEERING_LOADS.has(steeringLoad as BenchmarkSteeringLoad)) {
		throw new Error(`Invalid study observation steeringLoad for ${toolId}/${taskId}: ${String(steeringLoad)}`)
	}
	if (typeof scopeControl !== "string" || !VALID_SCOPE_CONTROLS.has(scopeControl as BenchmarkScopeControl)) {
		throw new Error(`Invalid study observation scopeControl for ${toolId}/${taskId}: ${String(scopeControl)}`)
	}
	if (typeof artifactClarity !== "string" || !VALID_ARTIFACT_CLARITY.has(artifactClarity as BenchmarkArtifactClarity)) {
		throw new Error(`Invalid study observation artifactClarity for ${toolId}/${taskId}: ${String(artifactClarity)}`)
	}
	if (runtimeMinutes !== null && (typeof runtimeMinutes !== "number" || !Number.isFinite(runtimeMinutes) || runtimeMinutes < 0)) {
		throw new Error(`Invalid study observation runtimeMinutes for ${toolId}/${taskId}: ${String(runtimeMinutes)}`)
	}
	if (date !== null && typeof date !== "string") {
		throw new Error(`Invalid study observation date for ${toolId}/${taskId}: ${String(date)}`)
	}
	if (typeof notes !== "string") {
		throw new Error(`Invalid study observation notes for ${toolId}/${taskId}: ${String(notes)}`)
	}

	return {
		toolId: toolId as BenchmarkToolId,
		taskId,
		outcome: outcome as BenchmarkOutcome,
		steeringLoad: steeringLoad as BenchmarkSteeringLoad,
		scopeControl: scopeControl as BenchmarkScopeControl,
		artifactClarity: artifactClarity as BenchmarkArtifactClarity,
		runtimeMinutes: runtimeMinutes as number | null,
		date: date as string | null,
		notes,
		evidence: asStringArray(evidence, `study observation evidence for ${toolId}/${taskId}`),
	}
}

function indexObservations(study: HeadToHeadStudy): Map<string, HeadToHeadStudyObservation> {
	const observationIndex = new Map<string, HeadToHeadStudyObservation>()
	for (const observation of study.observations) {
		const key = `${observation.toolId}:${observation.taskId}`
		if (observationIndex.has(key)) {
			throw new Error(`Duplicate study observation for ${observation.toolId}/${observation.taskId}`)
		}
		observationIndex.set(key, observation)
	}
	return observationIndex
}

export function buildHeadToHeadBenchmarkMatrix(): HeadToHeadBenchmarkMatrix {
	return {
		schemaVersion: 1,
		matrixVersion: HEAD_TO_HEAD_BENCHMARK_VERSION,
		tools: TOOLS.map((tool) => ({ ...tool, notes: [...tool.notes] })),
		tasks: TASKS.map((task) => ({
			...task,
			compareWhat: [...task.compareWhat],
			proofLinks: [...task.proofLinks],
			notes: [...task.notes],
		})),
		rules: [...RULES],
	}
}

export function buildHeadToHeadStudyTemplate(matrix = buildHeadToHeadBenchmarkMatrix()): HeadToHeadStudy {
	return {
		schemaVersion: 1,
		matrixVersion: matrix.matrixVersion,
		notes: [
			"Fill rows only with same-day observations on the fixed task text and repo fixture.",
			"Leave a row as not_run if the tool or environment is unavailable.",
			"Record evidence paths or notes for every observed row.",
		],
		observations: matrix.tools.flatMap((tool) => matrix.tasks.map((task) => defaultObservation(tool.id, task.id))),
	}
}

export function readHeadToHeadStudyFile(filePath: string, matrix = buildHeadToHeadBenchmarkMatrix()): HeadToHeadStudy {
	const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>
	if (raw["schemaVersion"] !== 1) {
		throw new Error(`Invalid head-to-head study schemaVersion in ${filePath}`)
	}
	if (raw["matrixVersion"] !== matrix.matrixVersion) {
		throw new Error(
			`Head-to-head study matrixVersion mismatch in ${filePath}: expected ${matrix.matrixVersion}, got ${String(raw["matrixVersion"])}`,
		)
	}

	const observations = raw["observations"]
	if (!Array.isArray(observations)) {
		throw new Error(`Invalid head-to-head study observations in ${filePath}: expected an array`)
	}

	const toolIds = new Set(matrix.tools.map((tool) => tool.id))
	const taskIds = new Set(matrix.tasks.map((task) => task.id))
	const validatedObservations = observations.map((observation) => validateObservation(observation, toolIds, taskIds))
	indexObservations({
		schemaVersion: 1,
		matrixVersion: matrix.matrixVersion,
		notes: raw["notes"] === undefined ? [] : asStringArray(raw["notes"], "study notes"),
		observations: validatedObservations,
	})

	return {
		schemaVersion: 1,
		matrixVersion: matrix.matrixVersion,
		notes: raw["notes"] === undefined ? [] : asStringArray(raw["notes"], "study notes"),
		observations: validatedObservations,
	}
}

export function buildHeadToHeadBenchmarkReport(rootDir: string, requestedStudyPath?: string): HeadToHeadBenchmarkReport {
	const matrix = buildHeadToHeadBenchmarkMatrix()
	const resolvedStudyPath = requestedStudyPath
		? path.resolve(requestedStudyPath)
		: fs.existsSync(path.join(rootDir, HEAD_TO_HEAD_STUDY_RELATIVE_PATH))
			? path.join(rootDir, HEAD_TO_HEAD_STUDY_RELATIVE_PATH)
			: path.join(rootDir, HEAD_TO_HEAD_STUDY_TEMPLATE_RELATIVE_PATH)
	const study =
		fs.existsSync(resolvedStudyPath) ? readHeadToHeadStudyFile(resolvedStudyPath, matrix) : buildHeadToHeadStudyTemplate(matrix)
	const observationIndex = indexObservations(study)

	const rows = matrix.tasks.map((task) => ({
		task,
		results: matrix.tools.map((tool) => ({
			tool,
			observation: observationIndex.get(`${tool.id}:${task.id}`) ?? defaultObservation(tool.id, task.id),
		})),
	}))

	const summaryByTool = matrix.tools.map<HeadToHeadBenchmarkToolSummary>((tool) => {
		const results = rows.map((row) => row.results.find((result) => result.tool.id === tool.id)?.observation ?? defaultObservation(tool.id, row.task.id))
		return {
			toolId: tool.id,
			toolLabel: tool.label,
			passCount: results.filter((result) => result.outcome === "pass").length,
			partialCount: results.filter((result) => result.outcome === "partial").length,
			failCount: results.filter((result) => result.outcome === "fail").length,
			unsupportedCount: results.filter((result) => result.outcome === "unsupported").length,
			notRunCount: results.filter((result) => result.outcome === "not_run").length,
		}
	})
	const coveredTaskFamilies = new Set(matrix.tasks.map((task) => task.corpusTaskId))
	const coverage: HeadToHeadBenchmarkCoverage = {
		rowCount: matrix.tasks.length,
		totalTaskFamilies: TASK_CORPUS_IDS.length,
		coveredTaskFamilies: coveredTaskFamilies.size,
		uncoveredTaskFamilies: TASK_CORPUS_IDS.filter((taskId) => !coveredTaskFamilies.has(taskId)),
	}

	return {
		matrix,
		study,
		studySource: fs.existsSync(resolvedStudyPath)
			? formatStudySource(rootDir, resolvedStudyPath)
			: "in-memory default template",
		summaryByTool,
		coverage,
		rows,
	}
}

export function formatHeadToHeadBenchmarkReport(report: HeadToHeadBenchmarkReport): string {
	return [
		"Head-to-head benchmark matrix",
		`Matrix version: ${report.matrix.matrixVersion}`,
		`Study source: ${report.studySource}`,
		"A row stays NOT RUN until the fixed task is observed on the listed repo fixture.",
		`Task sample coverage: ${report.coverage.coveredTaskFamilies}/${report.coverage.totalTaskFamilies} task families across ${report.coverage.rowCount} fixed row(s)`,
		`Coverage gaps: ${report.coverage.uncoveredTaskFamilies.join(", ") || "(none)"}`,
		"",
		"Rules:",
		...report.matrix.rules.map((rule, index) => `${index + 1}. ${rule}`),
		"",
		"Tools:",
		...report.matrix.tools.flatMap((tool) => [
			`- ${tool.label} (${formatToolMode(tool)})`,
			...tool.notes.map((note) => `  note: ${note}`),
		]),
		"",
		"Tasks:",
		...report.matrix.tasks.flatMap((task, index) => [
			`${index + 1}. ${task.title}`,
			`   Corpus task: ${task.corpusTaskId}`,
			`   Lane: ${task.lane}`,
			`   Fixture: ${task.workspaceFixture}`,
			`   Task: ${task.taskText}`,
			`   Compare: ${task.compareWhat.join(" | ")}`,
			`   Proof links: ${task.proofLinks.join(" | ")}`,
			...task.notes.map((note) => `   note: ${note}`),
		]),
		"",
		"Summary by tool:",
		...report.summaryByTool.map(
			(summary) =>
				`- ${summary.toolLabel}: pass=${summary.passCount} partial=${summary.partialCount} fail=${summary.failCount} unsupported=${summary.unsupportedCount} not_run=${summary.notRunCount}`,
		),
		...(report.study.notes.length > 0 ? ["", "Study notes:", ...report.study.notes.map((note) => `- ${note}`)] : []),
		"",
		"Recorded rows:",
		...report.rows.flatMap((row) => [
			`- ${row.task.id}: ${row.task.title}`,
			...row.results.map((result) => {
				const details = [
					formatOutcome(result.observation.outcome),
					`steering=${result.observation.steeringLoad}`,
					`scope=${result.observation.scopeControl}`,
					`artifacts=${result.observation.artifactClarity}`,
				]
				if (typeof result.observation.runtimeMinutes === "number") {
					details.push(`minutes=${result.observation.runtimeMinutes}`)
				}
				if (result.observation.date) {
					details.push(`date=${result.observation.date}`)
				}
				if (result.observation.evidence.length > 0) {
					details.push(`evidence=${result.observation.evidence.join(", ")}`)
				}
				if (result.observation.notes.trim()) {
					details.push(`notes=${result.observation.notes.trim()}`)
				}
				return `  ${result.tool.label}: ${details.join(" | ")}`
			}),
		]),
	].join("\n")
}
