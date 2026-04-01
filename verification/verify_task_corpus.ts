import fs from "node:fs"
import path from "node:path"

import { buildTaskCorpusReport, formatTaskCorpusReport } from "../src/owner/TaskCorpus"
import { TASK_CORPUS_IDS } from "../src/owner/TaskCorpusIds"
import { buildReplayArtifact } from "../src/run/ReplayExport"
import { writeReplayArtifact, writeRunSummary } from "../src/run/RunArtifacts"
import type { DailyDriverEntry } from "../src/release/Rc1Ops"
import type { BetaRunSummary, BetaRowResult } from "./verify_live_beta"

export type TaskCorpusHarnessResult = {
	catalogValidationPasses: boolean
	ownerAndBetaEvidenceGrouped: boolean
	strangerBaselineVisible: boolean
	benchmarkAndDemoLinksVisible: boolean
	structuredCoverageVisible: boolean
	steeringAndCostBaselineVisible: boolean
	scoutPlaybookVisible: boolean
	reliabilitySignalsVisible: boolean
	replayLearningVisible: boolean
	nextFocusVisible: boolean
	queenBeeDailyCorpusVisible: boolean
	queenBeeAcceptanceFixturesVisible: boolean
	queenBeeProgramAligned: boolean
	queenBeeGovernanceVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function makeOwnerEntry(overrides: Partial<DailyDriverEntry>): DailyDriverEntry {
	return {
		date: "2026-03-23",
		workspace: "C:\\Users\\owner\\SwarmPractice",
		task: "add a brief comment to hello.ts about startup flow",
		runId: "owner-run-1",
		surface: "cli_artifact",
		terminalStatus: "done",
		reviewerVerdict: "PASS",
		acceptanceGate: "passed",
		verificationProfile: "not_applicable",
		manualRepair: false,
		credited: true,
		endedAt: "2026-03-23T12:00:00.000Z",
		recordedAt: "2026-03-23T12:00:01.000Z",
		summaryPath: "C:\\Users\\owner\\SwarmPractice\\.swarm\\runs\\owner-run-1\\summary.json",
		...overrides,
	}
}

function makeBetaRow(overrides: Partial<BetaRowResult>): BetaRowResult {
	return {
		id: "beta-row-1",
		corpusTaskId: "comment_file",
		repoId: "ts-cli-tool",
		repoLabel: "TS CLI Tool",
		workspace: "D:\\Beta\\ts-cli-tool",
		task: 'add the exact comment "// beta: cli banner" near the top of src/index.ts',
		verdict: "pass",
		passed: true,
		status: "done",
		stopReason: "completed",
		durationMs: 1234,
		admissionDecision: "allow",
		admissionReasonCodes: [],
		summaryPath: "D:\\Beta\\ts-cli-tool\\.swarm\\runs\\beta-row-1\\summary.json",
		artifactDir: "D:\\Beta\\artifacts\\beta-row-1",
		changedFiles: ["src/index.ts"],
		repoCleanAfter: true,
		expectedVerificationProfile: "local-npm-test",
		observedVerificationProfile: "local-npm-test",
		expectedSupportTier: "small_supported",
		observedSupportTier: "small_supported",
		observedSupportTierLabel: "Small supported repo",
		details: [],
		...overrides,
	}
}

function writeAcceptedEvidence(
	artifactRoot: string,
	runId: string,
	task: string,
	options: {
		workspace: string
		pathChosen: string
		changedFiles: string[]
		verificationProfile: string
		observedAt: string
	},
): { summaryPath: string; artifactDir: string } {
	const artifactDir = path.join(artifactRoot, runId)
	const runDir = path.join(artifactDir, ".swarm", "runs", runId)
	fs.mkdirSync(runDir, { recursive: true })
	const summary = {
		taskId: runId,
		task,
		workspace: options.workspace,
		status: "done",
		stopReason: "success",
		pathChosen: options.pathChosen,
		endedAt: options.observedAt,
		reviewerVerdict: "PASS",
		acceptanceGate: { passed: true, failedChecks: [] },
		taskContract: {
			scope: {
				allowedFiles: options.changedFiles,
				requiredTargetFiles: options.changedFiles,
				maxEditedFileCount: options.changedFiles.length,
			},
		},
		changedFiles: options.changedFiles,
		verificationProfile: {
			profileName: options.verificationProfile,
			status: "passed",
		},
	}
	const summaryPath = writeRunSummary(runDir, summary)
	const replayArtifact = buildReplayArtifact(runDir, summaryPath, summary, [])
	const replayArtifactPath = writeReplayArtifact(runDir, replayArtifact)
	writeRunSummary(runDir, {
		...summary,
		replayArtifactPath,
		replayOverview: {
			gateMode: replayArtifact.gateMode,
			eventCount: replayArtifact.eventCount,
			stageCounts: replayArtifact.stageCounts,
			planningSummary: replayArtifact.overview.planningSummary,
			coordinationSummary: replayArtifact.overview.coordinationSummary,
			reviewSummary: replayArtifact.overview.reviewSummary,
			artifactSummary: replayArtifact.overview.artifactSummary,
			highlightCount: replayArtifact.overview.highlights.length,
			highlights: replayArtifact.overview.highlights,
		},
	})
	return { summaryPath, artifactDir }
}

export async function runTaskCorpusHarness(rootDir = resolveRootDir()): Promise<TaskCorpusHarnessResult> {
	const details: string[] = []
	const artifactRoot = path.join(rootDir, "verification", `.tmp-task-corpus-artifacts-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(artifactRoot, { recursive: true })
	const readDoc = (relativePath: string): string => fs.readFileSync(path.join(rootDir, relativePath), "utf8")

	try {
		const ownerCommentEvidence = writeAcceptedEvidence(artifactRoot, "owner-comment-pass", "add a brief comment to hello.ts about startup flow", {
			workspace: "C:\\Users\\owner\\SwarmPractice",
			pathChosen: "small_task",
			changedFiles: ["hello.ts"],
			verificationProfile: "not_applicable",
			observedAt: "2026-03-23T12:00:00.000Z",
		})
		const betaCommentEvidence = writeAcceptedEvidence(artifactRoot, "beta-comment-pass", 'add the exact comment "// beta: cli banner" near the top of src/index.ts', {
			workspace: "D:\\Beta\\ts-cli-tool",
			pathChosen: "small_task",
			changedFiles: ["src/index.ts"],
			verificationProfile: "local-npm-test",
			observedAt: "2026-03-23T12:30:00.000Z",
		})

		const ownerEntries: DailyDriverEntry[] = [
			makeOwnerEntry({ runId: "owner-comment-pass", summaryPath: ownerCommentEvidence.summaryPath }),
		makeOwnerEntry({
			runId: "owner-comment-fail",
			terminalStatus: "failed",
			reviewerVerdict: "missing",
			acceptanceGate: "failed",
			credited: false,
			endedAt: "2026-03-23T12:10:00.000Z",
			recordedAt: "2026-03-23T12:10:01.000Z",
			summaryPath: "C:\\Users\\owner\\SwarmPractice\\.swarm\\runs\\owner-comment-fail\\summary.json",
		}),
		makeOwnerEntry({
			runId: "owner-create-pass",
			task: "create notes.md with one sentence describing this repo",
			summaryPath: "C:\\Users\\owner\\SwarmPractice\\.swarm\\runs\\owner-create-pass\\summary.json",
		}),
		makeOwnerEntry({
			runId: "owner-rename-review",
			task: "rename the export in src/format.ts to formatValue and update its direct call sites",
			terminalStatus: "review_required",
			reviewerVerdict: "missing",
			acceptanceGate: "failed",
			credited: false,
			summaryPath: "C:\\Users\\owner\\SwarmPractice\\.swarm\\runs\\owner-rename-review\\summary.json",
		}),
		makeOwnerEntry({
			runId: "ignored-beta-like",
			workspace: path.join(rootDir, ".swarm", "beta_workspaces", "ts_cli_tool"),
			task: 'add the exact comment "// beta: cli banner" near the top of src/index.ts',
			summaryPath: path.join(rootDir, ".swarm", "beta_workspaces", "ts_cli_tool", ".swarm", "runs", "ignored", "summary.json"),
		}),
		]

		const betaResults: BetaRowResult[] = [
			makeBetaRow({ id: "beta-comment-pass", summaryPath: betaCommentEvidence.summaryPath, artifactDir: betaCommentEvidence.artifactDir }),
		makeBetaRow({
			id: "beta-docs-fail",
			corpusTaskId: "sync_docs_with_source",
			task: "sync the repo-root readme with src/config.ts by updating the readme",
			verdict: "failed",
			passed: false,
			status: "failed",
			stopReason: "provider_transport_failure",
			summaryPath: "D:\\Beta\\config-service\\.swarm\\runs\\beta-docs-fail\\summary.json",
			artifactDir: "D:\\Beta\\artifacts\\beta-docs-fail",
		}),
		]

		const betaSummary: BetaRunSummary = {
			generatedAt: "2026-03-23T12:30:00.000Z",
			totalRows: betaResults.length,
			passCount: 1,
			reviewRequiredCount: 0,
			failedCount: 1,
			refusedCount: 0,
			passRate: 50,
			successByCorpus: [
				{ corpusTaskId: "comment_file", observed: 1, passCount: 1, passRate: 100, rowIds: ["beta-comment-pass"] },
				{ corpusTaskId: "sync_docs_with_source", observed: 1, passCount: 0, passRate: 0, rowIds: ["beta-docs-fail"] },
			],
			successBySupportTier: [{ supportTier: "small_supported", label: "Small supported repo", observed: 2, passCount: 1, passRate: 50, rowIds: ["beta-comment-pass", "beta-docs-fail"] }],
			topFailureBuckets: [{ bucket: "provider or config failure", count: 1, rowIds: ["beta-docs-fail"], nextArtifact: "D:\\Beta\\artifacts\\beta-docs-fail" }],
			results: betaResults,
		}

	const studyText = `# Stranger First-Run Study

## Session 108 Baseline Study

Surfaces used:

1. BUNDLE_START_HERE.md
2. npm.cmd run repo:onboard -- --workspace <repo>
3. npm.cmd run owner:guided:demo

## Top Friction Found

1. repo:onboard did not tell the user what to do next
2. there was no single place to see which tasks were actually succeeding
`

		const report = buildTaskCorpusReport(rootDir, {
			dailyDriverEntries: ownerEntries,
			betaSummary,
			betaSummaryPath: "provided beta summary",
			strangerStudyText: studyText,
			generatedAt: "2026-03-23T13:00:00.000Z",
		})
		const output = formatTaskCorpusReport(report)
		const canonicalTaskSetText = readDoc("QUEENBEE_CANONICAL_TASK_SET.md")
		const benchmarkPlanText = readDoc("QUEENBEE_BENCHMARK_PLAN.md")
		const sideBySideText = readDoc("QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
		const dailyProgramText = readDoc("QUEENBEE_DAILY_JSTS_PROGRAM.md")
		const allocationPolicyText = readDoc("QUEENBEE_ALLOCATION_POLICY.md")
		const proportionalGateText = readDoc("QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md")
		const gapRegisterText = readDoc("QUEENBEE_GAP_REGISTER.md")
		const evalRubricText = readDoc("QUEENBEE_EXPERT_EVAL_RUBRIC.md")
		const confidenceContractText = readDoc("QUEENBEE_OPERATOR_CONFIDENCE_CONTRACT.md")
		const traceabilityText = readDoc("QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
		const architectureText = readDoc("ARCHITECTURE_DECISIONS.md")
		const capabilityChecklistText = readDoc("SWARM_CAPABILITY_CHECKLIST.md")
		const verificationCatalogText = readDoc("VERIFICATION_CATALOG.md")

		const commentRow = report.rows.find((row) => row.id === "comment_file")
		const renameRow = report.rows.find((row) => row.id === "rename_export")
		const docsBundleRow = report.rows.find((row) => row.id === "sync_docs_bundle")
		const docsRow = report.rows.find((row) => row.id === "sync_docs_with_source")
		const boundedTwoFileRow = report.rows.find((row) => row.id === "bounded_two_file_update")
		const mediumRow = report.rows.find((row) => row.id === "medium_multi_file_update")
		const crossLanguageRow = report.rows.find((row) => row.id === "cross_language_sync")
		const helperTestRow = report.rows.find((row) => row.id === "update_file_and_test")

		const catalogValidationPasses = report.catalogValidationIssues.length === 0
		const ownerAndBetaEvidenceGrouped =
			commentRow?.ownerObserved === 2 &&
			commentRow.ownerPassCount === 1 &&
			commentRow.betaObserved === 1 &&
			commentRow.betaPassCount === 1 &&
			commentRow.totalPassCount === 2 &&
			report.ownerObservationCount === 4 &&
			report.betaObservationCount === 2
		const strangerBaselineVisible =
			report.studyBaseline.surfacesUsed.includes("npm.cmd run repo:onboard -- --workspace <repo>") &&
			report.studyBaseline.topFriction.includes("there was no single place to see which tasks were actually succeeding") &&
			output.includes("Top stranger friction:")
		const benchmarkAndDemoLinksVisible =
			Boolean(commentRow && commentRow.demoExampleIds.includes("demo-pack-comment") && commentRow.benchmarkTaskIds.includes("demo_pack_comment")) &&
			Boolean(renameRow && renameRow.demoExampleIds.includes("guided-rename-export") && renameRow.benchmarkTaskIds.includes("rename_export_direct_calls")) &&
			Boolean(docsBundleRow && docsBundleRow.benchmarkTaskIds.includes("docs_bundle_readme_faq_sync")) &&
			Boolean(boundedTwoFileRow && boundedTwoFileRow.demoExampleIds.includes("bounded-two-file-update") && boundedTwoFileRow.benchmarkTaskIds.includes("scoped_two_file_update")) &&
			Boolean(mediumRow && mediumRow.demoExampleIds.includes("medium-six-file-update") && mediumRow.benchmarkTaskIds.includes("explicit_medium_six_file_sync")) &&
			Boolean(crossLanguageRow && crossLanguageRow.benchmarkTaskIds.includes("cross_language_reporter_sync")) &&
			output.includes("Benchmark rows:")
		const structuredCoverageVisible =
			report.sampleCoverage.totalFamilies === TASK_CORPUS_IDS.length &&
			report.sampleCoverage.benchmarkCoveredFamilies === TASK_CORPUS_IDS.length &&
			report.sampleCoverage.benchmarkRowCount === TASK_CORPUS_IDS.length &&
			report.sampleCoverage.uncoveredBenchmarkFamilies.length === 0 &&
			output.includes("Structured sample coverage:") &&
			output.includes("Benchmark-covered families:")
		const steeringAndCostBaselineVisible =
			Boolean(commentRow && commentRow.steeringLoad === "low" && commentRow.costEnvelope === "low") &&
			Boolean(boundedTwoFileRow && boundedTwoFileRow.steeringLoad === "medium" && boundedTwoFileRow.costEnvelope === "medium") &&
			Boolean(mediumRow && mediumRow.steeringLoad === "high" && mediumRow.costEnvelope === "high") &&
			output.includes("Steering and cost baseline:") &&
			output.includes("Task family | Steering | Cost envelope | Why")
		const scoutPlaybookVisible =
			Boolean(helperTestRow && helperTestRow.scoutPlaybook.some((line) => line.includes("Derive exactly one nearby test file"))) &&
			Boolean(docsRow && docsRow.scoutPlaybook.some((line) => line.includes("Prefer knowledge-pack docs"))) &&
			Boolean(mediumRow && mediumRow.scoutPlaybook.some((line) => line.includes("Carry one config plus one entry-point hint"))) &&
			output.includes("Scout playbook:")
		const reliabilitySignalsVisible =
			Boolean(
				mediumRow &&
					mediumRow.reliabilitySignals.some((line) => line.includes("Mode selector must stay explicit")) &&
					mediumRow.reliabilitySignals.some((line) => line.includes("Critic review and targeted evaluators")) &&
					mediumRow.reliabilitySignals.some((line) => line.includes("Checkpoint and retry snapshot artifacts")) &&
					mediumRow.reliabilitySignals.some((line) => line.includes("Repo-backed verification should pass")),
			) && output.includes("Reliability signals:")
		const replayLearningVisible =
			Boolean(
				commentRow &&
					commentRow.acceptedExampleCount === 2 &&
					commentRow.replayLearningSummary.includes("Accepted replay examples: 2") &&
					commentRow.acceptedExamples.some((example) => example.learningSource === "replay_artifact"),
			) &&
			output.includes("Replay learning:")
		const nextFocusVisible =
			Boolean(boundedTwoFileRow && boundedTwoFileRow.nextFocus.includes("Collect the first artifact-backed observation")) &&
			Boolean(docsRow && docsRow.nextFocus.includes("Reduce failures")) &&
			output.includes("Next focus")
		const queenBeeDailyCorpusVisible =
			includesAll(canonicalTaskSetText, [
				"## Session 271 Daily JS/TS Corpus Answer",
				"`QB-CAN-01`, `QB-CAN-03`, `QB-CAN-04`, `QB-CAN-05`, `QB-CAN-06`, and `QB-CAN-07` now define the current daily JS/TS six-family corpus",
				"`QB-CAN-02` remains supported as one internal create-safe row",
				"`verify:queenbee:live:canonical`",
				"## Session 276 Daily Repo Matrix Answer",
				"`QB-GW-01` through `QB-GW-04` now provide the recurring repo-local comparison matrix",
			]) &&
			includesAll(sideBySideText, [
				"## Session 271 Daily Corpus And Acceptance Fixture Reading",
				"`QB-EX-01` through `QB-EX-06` now define the fixed daily JS/TS comparison corpus",
				"`QB-EX-07` stays outside that six-family daily comparison corpus",
				"## Session 276 Specialist Daily Repo Matrix Reading",
				"`QB-EX-08` through `QB-EX-11` now define one bounded daily repo task matrix",
			])
		const queenBeeAcceptanceFixturesVisible = includesAll(benchmarkPlanText, [
			"`acceptanceFixtureBundle`",
			"## Session 271 Daily Corpus And Acceptance Fixture Reading",
			"`QB-BM-01` through `QB-BM-06` now define the fixed daily JS/TS candidate comparison corpus",
			"`QB-LIVE-03`",
			"`verify:queenbee:jsts:file-and-test`",
			"`verify:queenbee:jsts:rename`",
			"`verify:queenbee:jsts:node`",
			"`verify:queenbee:bounded-node`",
			"`QB-BM-07` stays outside that daily six-family comparison corpus",
			"## Session 274 Daily Capability Gate Reading",
			"`QB-BM-01` through `QB-BM-06` plus their live anchors and the explicit `QB-LIVE-03` hold anchor are now enough to support one serious bounded daily JS/TS capability answer",
			"`QB-BM-08` through `QB-BM-11`, the natural-language hold pack, and `verify:queenbee:gateway`",
			"## Session 276 Specialist Daily Repo Matrix Reading",
			"`QB-BM-08` through `QB-BM-11` now define one bounded daily repo task matrix",
			"`JSTSTestBee`, `JSTSAsyncBee`, `JSTSNodeBee`, and `JSTSRefactorBee`",
		])
		const queenBeeProgramAligned = includesAll(dailyProgramText, [
			"## Session 271 Daily Corpus And Fixture Update",
			"`QB-BM-01` through `QB-BM-06` and `QB-EX-01` through `QB-EX-06` now form the recurring comparison surface",
			"`QB-LIVE-03` remains the explicit daily-corpus hold row",
			"`QB-CAN-02` still stays outside the public daily six-family comparison corpus",
			"## Session 272 Review, Verification, And Rework Hardening",
			"`comment_file` and `update_named_file` now require explicit bounded review-surface wording",
			"`verify:queenbee:jsts:small`",
			"## Session 274 Daily JS/TS Capability Gate",
			"QueenBee is now a serious bounded daily JS/TS capability surface",
			"Phase C may begin because five provider-backed canonical live rows, one provider-backed gateway live row, one fixed six-row daily corpus with acceptance fixtures",
			"## Session 276 Specialist Daily Repo Matrix Update",
			"`QB-BM-08` through `QB-BM-11` and `QB-EX-08` through `QB-EX-11`",
			"helper/test -> `JSTSTestBee`",
			"## Session 277 Matrix Quality Confidence Update",
			"`comment_file`, `update_named_file`, `bounded_two_file_update`, `update_file_and_test`, `rename_export`, and `bounded_node_cli_task`",
			"`verify:queenbee:jsts:async`",
		])
		const queenBeeGovernanceVisible =
			includesAll(architectureText, [
				"## Decision: Session 271 fixes one six-row QueenBee daily JS/TS corpus and acceptance-fixture surface without widening the public beta boundary",
				"**Session:** 271",
				"`QB-BM-01` through `QB-BM-06`",
				"`QB-CAN-02`",
				"## Decision: Session 272 hardens the small-file daily QueenBee quality lane around explicit review surfaces and row-aligned proof bundles",
				"**Session:** 272",
				"## Decision: Session 274 records QueenBee as a serious bounded daily JS/TS capability surface and opens Phase C inside the same envelope",
				"**Session:** 274",
				"## Decision: Session 276 grounds the current specialist family in one bounded daily repo task matrix",
				"**Session:** 276",
				"## Decision: Session 277 carries row-specific review and proof wording across the current daily JS/TS matrix",
				"**Session:** 277",
			]) &&
			includesAll(allocationPolicyText, [
				"## Session 276 Daily Repo Matrix Reading",
				"`QB-BM-08` through `QB-BM-11` now form the bounded recurring repo-local matrix",
				"`QB-LIVE-GW-01` remains the only live gateway anchor",
			]) &&
			includesAll(proportionalGateText, [
				"Current gate answer: `SERIOUS_BOUNDED_DAILY_JSTS_SURFACE`",
				"five provider-backed canonical live rows, one provider-backed gateway live row, one fixed six-row daily JS/TS corpus with acceptance fixtures",
				"Phase C may begin, but only inside the same bounded envelope",
			]) &&
			includesAll(gapRegisterText, [
				"`QB-GAP-274-01`",
				"`CLOSED_SESSION_274`",
				"## Session 274 Reading",
			]) &&
			includesAll(capabilityChecklistText, [
				"| B61 |",
				"Does QueenBee now have one fixed six-row daily JS/TS corpus with explicit acceptance-fixture evidence, live anchors where proven, and hold anchors where not? | YES |",
				"`npm.cmd run verify:task-corpus`",
				"| B62 |",
				"`npm.cmd run verify:queenbee:jsts:verify`",
				"| B64 |",
				"Is QueenBee now a serious bounded daily JS/TS capability surface inside the current six-family, repo-local, experimental envelope? | YES |",
				"| B66 |",
				"Does QueenBee now ground its current inner specialist family in one bounded daily repo task matrix",
				"| B67 |",
				"Does QueenBee now keep the current daily JS/TS matrix on row-specific review, proof, and completion wording",
			]) &&
			includesAll(verificationCatalogText, [
				"the Session 271 daily JS/TS corpus now records `QB-BM-01` through `QB-BM-06`",
				"acceptance-fixture bundles",
				"`QB-LIVE-03` hold anchor",
				"the Session 272 small-file daily quality lane now records explicit review-surface wording",
				"`verify:queenbee:jsts:small`",
				"the Session 274 daily JS/TS capability gate now records QueenBee as a serious bounded daily JS/TS capability surface",
				"the Session 276 specialist daily repo matrix now records `QB-BM-08` through `QB-BM-11`",
				"the Session 277 daily JS/TS matrix quality-confidence lane now carries row-specific review wording",
			]) &&
			includesAll(evalRubricText, [
				"## Session 272 Quality Lane Reading",
				"review summary should name the bounded review surface",
				"generic proof wording is not enough when a row-specific proof bundle already exists",
				"## Session 277 Daily Matrix Quality Reading",
				"verifier and completion artifacts should now carry the exact row proof bundle",
			]) &&
			includesAll(confidenceContractText, [
				"## Session 272 Review And Proof Clarity",
				"`review_pass` and `review_rework` should name the bounded review surface",
				"the verifier surface should name the proof command that actually ran",
				"## Session 277 Daily Matrix Verification Confidence",
				"verifier and archive summaries",
			]) &&
			includesAll(traceabilityText, [
				"## Session 277 Daily Matrix Proof Reading",
				"`QB-TR-01` through `QB-TR-06`",
				"`verify:queenbee:jsts:two-file`",
				"`verify:queenbee:bounded-node`",
			])

		details.push(`commentRow=${commentRow ? `${commentRow.totalPassCount}/${commentRow.totalObserved}` : "missing"}`)
		details.push(`renameRow=${renameRow ? renameRow.nextFocus : "missing"}`)
		details.push(`docsRow=${docsRow ? docsRow.nextFocus : "missing"}`)

		return {
			catalogValidationPasses,
			ownerAndBetaEvidenceGrouped,
			strangerBaselineVisible,
			benchmarkAndDemoLinksVisible,
			structuredCoverageVisible,
			steeringAndCostBaselineVisible,
			scoutPlaybookVisible,
			reliabilitySignalsVisible,
			replayLearningVisible,
			nextFocusVisible,
			queenBeeDailyCorpusVisible,
			queenBeeAcceptanceFixturesVisible,
			queenBeeProgramAligned,
			queenBeeGovernanceVisible,
			details,
		}
	} finally {
		if (fs.existsSync(artifactRoot)) fs.rmSync(artifactRoot, { recursive: true, force: true })
	}
}

export function formatTaskCorpusHarnessResult(result: TaskCorpusHarnessResult): string {
	return [
		`Catalog validation passes: ${result.catalogValidationPasses ? "PASS" : "FAIL"}`,
		`Owner and beta evidence grouped: ${result.ownerAndBetaEvidenceGrouped ? "PASS" : "FAIL"}`,
		`Stranger baseline visible: ${result.strangerBaselineVisible ? "PASS" : "FAIL"}`,
		`Benchmark and demo links visible: ${result.benchmarkAndDemoLinksVisible ? "PASS" : "FAIL"}`,
		`Structured coverage visible: ${result.structuredCoverageVisible ? "PASS" : "FAIL"}`,
		`Steering and cost baseline visible: ${result.steeringAndCostBaselineVisible ? "PASS" : "FAIL"}`,
		`Scout playbook visible: ${result.scoutPlaybookVisible ? "PASS" : "FAIL"}`,
		`Reliability signals visible: ${result.reliabilitySignalsVisible ? "PASS" : "FAIL"}`,
		`Replay learning visible: ${result.replayLearningVisible ? "PASS" : "FAIL"}`,
		`Next focus visible: ${result.nextFocusVisible ? "PASS" : "FAIL"}`,
		`QueenBee daily corpus visible: ${result.queenBeeDailyCorpusVisible ? "PASS" : "FAIL"}`,
		`QueenBee acceptance fixtures visible: ${result.queenBeeAcceptanceFixturesVisible ? "PASS" : "FAIL"}`,
		`QueenBee daily program aligned: ${result.queenBeeProgramAligned ? "PASS" : "FAIL"}`,
		`QueenBee governance visible: ${result.queenBeeGovernanceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runTaskCorpusHarness()
	console.log(formatTaskCorpusHarnessResult(result))
	process.exit(
		result.catalogValidationPasses &&
			result.ownerAndBetaEvidenceGrouped &&
			result.strangerBaselineVisible &&
			result.benchmarkAndDemoLinksVisible &&
			result.structuredCoverageVisible &&
			result.steeringAndCostBaselineVisible &&
			result.scoutPlaybookVisible &&
			result.reliabilitySignalsVisible &&
			result.replayLearningVisible &&
			result.nextFocusVisible &&
			result.queenBeeDailyCorpusVisible &&
			result.queenBeeAcceptanceFixturesVisible &&
			result.queenBeeProgramAligned &&
			result.queenBeeGovernanceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:task-corpus] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
