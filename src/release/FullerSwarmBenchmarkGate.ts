import fs from "node:fs"
import path from "node:path"

import { buildHeadToHeadBenchmarkReport } from "../benchmark/HeadToHeadBenchmark"
import { buildDemoGallery } from "../owner/DemoGallery"
import { buildTaskCorpusReport } from "../owner/TaskCorpus"

export type FullerSwarmBenchmarkGateCheck = {
	label: string
	passed: boolean
	details: string[]
}

export type FullerSwarmBenchmarkGateResult = {
	decision: "GO" | "HOLD"
	summary: string
	checks: FullerSwarmBenchmarkGateCheck[]
}

function findCorpusRow(
	rows: ReturnType<typeof buildTaskCorpusReport>["rows"],
	id: "bounded_two_file_update" | "medium_multi_file_update" | "cross_language_sync",
) {
	return rows.find((row) => row.id === id) ?? null
}

export function evaluateFullerSwarmBenchmarkGate(rootDir: string): FullerSwarmBenchmarkGateResult {
	const benchmarkReport = buildHeadToHeadBenchmarkReport(rootDir)
	const taskCorpusReport = buildTaskCorpusReport(rootDir)
	const demoGallery = buildDemoGallery(rootDir)
	const docPath = path.join(rootDir, "FULLER_SWARM_BENCHMARK_GATE.md")
	const docText = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : ""

	const matrixTaskIds = benchmarkReport.matrix.tasks.map((task) => task.id)
	const requiredTaskIds = [
		"demo_pack_comment",
		"guided_note_file",
		"semiopen_helper_test_sync",
		"semiopen_docs_sync",
		"rename_export_direct_calls",
		"docs_bundle_readme_faq_sync",
		"explicit_config_file_update",
		"scoped_two_file_update",
		"explicit_medium_six_file_sync",
		"cross_language_reporter_sync",
	]
	const matrixLocked = {
		label: "Fixed benchmark matrix is still locked",
		passed:
			benchmarkReport.matrix.tools.length === 3 &&
			benchmarkReport.matrix.tasks.length === requiredTaskIds.length &&
			requiredTaskIds.every((taskId) => matrixTaskIds.includes(taskId)),
		details: [
			`tools=${benchmarkReport.matrix.tools.length}`,
			`tasks=${benchmarkReport.matrix.tasks.length}`,
			`matrixVersion=${benchmarkReport.matrix.matrixVersion}`,
		],
	}

	const twoFileRow = findCorpusRow(taskCorpusReport.rows, "bounded_two_file_update")
	const mediumRow = findCorpusRow(taskCorpusReport.rows, "medium_multi_file_update")
	const crossLanguageRow = findCorpusRow(taskCorpusReport.rows, "cross_language_sync")
	const benchmarkCoveredFamilies = taskCorpusReport.rows.filter((row) => row.benchmarkTaskIds.length > 0).length
	const corpusCoverage = {
		label: "Task corpus and benchmark pack cover the fuller-swarm evidence lanes",
		passed:
			benchmarkCoveredFamilies === taskCorpusReport.rows.length &&
			Boolean(twoFileRow && twoFileRow.benchmarkTaskIds.length > 0 && twoFileRow.proofCommands.includes("npm.cmd run verify:replay-export")) &&
			Boolean(mediumRow && mediumRow.proofCommands.includes("npm.cmd run verify:lane:medium")) &&
			Boolean(crossLanguageRow && crossLanguageRow.proofCommands.includes("npm.cmd run verify:live:beta")),
		details: [
			`benchmarkCoveredFamilies=${benchmarkCoveredFamilies}/${taskCorpusReport.rows.length}`,
			`two-file benchmarks=${twoFileRow?.benchmarkTaskIds.join(", ") || "(none)"}`,
			`medium proof=${mediumRow?.proofCommands.join(" | ") || "(none)"}`,
			`cross-language proof=${crossLanguageRow?.proofCommands.join(" | ") || "(none)"}`,
		],
	}

	const mediumExample = demoGallery.examples.find((example) => example.corpusTaskId === "medium_multi_file_update") ?? null
	const demoTransparency = {
		label: "Demo and replay surfaces still explain the fuller swarm",
		passed:
			Boolean(
				mediumExample &&
					mediumExample.proofSource.includes("npm.cmd run verify:lane:medium") &&
					mediumExample.proofSource.includes("npm.cmd run verify:replay-export") &&
					mediumExample.proofSource.includes("npm.cmd run task-corpus:report"),
			),
		details: [`medium-demo=${mediumExample?.id ?? "(missing)"}`],
	}

	const rooSummary = benchmarkReport.summaryByTool.find((summary) => summary.toolId === "roo_code")
	const clineSummary = benchmarkReport.summaryByTool.find((summary) => summary.toolId === "cline")
	const competitorHonesty = {
		label: "Competitor benchmark rows remain honest when still unobserved",
		passed:
			Boolean(rooSummary && rooSummary.notRunCount === benchmarkReport.matrix.tasks.length) &&
			Boolean(clineSummary && clineSummary.notRunCount === benchmarkReport.matrix.tasks.length),
		details: [
			`roo not_run=${rooSummary?.notRunCount ?? 0}`,
			`cline not_run=${clineSummary?.notRunCount ?? 0}`,
		],
	}

	const docsReady = {
		label: "Fuller-swarm benchmark gate doc is present and command-linked",
		passed:
			fs.existsSync(docPath) &&
			docText.includes("benchmark:head-to-head") &&
			docText.includes("task-corpus:report") &&
			docText.includes("verify:release:fuller-v2"),
		details: [`doc=${fs.existsSync(docPath) ? "present" : "missing"}`],
	}

	const checks = [matrixLocked, corpusCoverage, demoTransparency, competitorHonesty, docsReady]
	const passed = checks.every((check) => check.passed)

	return {
		decision: passed ? "GO" : "HOLD",
		summary: passed
			? "The fuller-swarm benchmark gate is satisfied by the fixed matrix, task-corpus evidence, demo transparency, and explicit docs."
			: "Hold the next roadmap band until the fuller-swarm benchmark surfaces are aligned again.",
		checks,
	}
}
