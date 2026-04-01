import fs from "node:fs"
import path from "node:path"

import { DatabaseService } from "../src/db/DatabaseService"
import { evaluateAdmission } from "../src/run/AdmissionGate"
import { readRunSummary } from "../src/run/RunArtifacts"
import { runSwarmEngineRuntime } from "../src/swarmengine/SwarmEngineRuntime"
import { createTempTestRepoCopy } from "./test_workspace_baseline"
import {
	QUEENBEE_JSTS_SMALL_TASK,
	formatQueenBeeJstsSmallHarnessResult,
	runQueenBeeJstsSmallHarness,
} from "./verify_queenbee_jsts_small"

type SwarmEngineSmallComparisonObservation = {
	task: string
	admitted: boolean
	summaryPresent: boolean
	summaryPath: string | null
	status: string
	stopReason: string
	pathChosen: string | null
	modeId: string | null
	fastLaneId: string | null
	allowedFiles: string[]
	requiredTargetFiles: string[]
	changedFiles: string[]
	replayHighlights: string[]
	smallLaneVisible: boolean
	scopeStayedBounded: boolean
	artifactTruthVisible: boolean
	details: string[]
}

export type QueenBeeSmallComparisonHarnessResult = {
	packageScriptPresent: boolean
	comparisonDocsPresent: boolean
	comparisonStayedCandidateOnly: boolean
	sameTaskFamilyVisible: boolean
	swarmengineTaskAdmitted: boolean
	swarmengineSummaryPresent: boolean
	swarmengineSmallLaneVisible: boolean
	swarmengineScopeStayedBounded: boolean
	swarmengineArtifactTruthVisible: boolean
	queenbeeProtocolVisible: boolean
	queenbeeScopeStayedBounded: boolean
	swarmengine: SwarmEngineSmallComparisonObservation
	queenbeeSummary: string
	queenbeeDetails: string[]
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
		: []
}

function formatConsoleArgs(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === "string") return arg
			try {
				return JSON.stringify(arg)
			} catch {
				return String(arg)
			}
		})
		.join(" ")
}

async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
	const lines: string[] = []
	const originalLog = console.log
	const originalWarn = console.warn
	console.log = (...args: unknown[]) => {
		lines.push(formatConsoleArgs(args))
	}
	console.warn = (...args: unknown[]) => {
		lines.push(formatConsoleArgs(args))
	}
	try {
		const result = await fn()
		return { result, lines }
	} finally {
		console.log = originalLog
		console.warn = originalWarn
	}
}

async function observeSwarmEngineSmallComparison(rootDir: string): Promise<SwarmEngineSmallComparisonObservation> {
	const fixture = await createTempTestRepoCopy(rootDir, "swarmengine-small-compare")
	try {
		DatabaseService.reset()
		const task = QUEENBEE_JSTS_SMALL_TASK
		const admission = await evaluateAdmission({
			workspace: fixture.repoPath,
			task,
			allowDirty: false,
		})
		if (admission.decision === "refuse") {
			return {
				task,
				admitted: false,
				summaryPresent: false,
				summaryPath: null,
				status: "not_started",
				stopReason: "admission_refused",
				pathChosen: null,
				modeId: null,
				fastLaneId: null,
				allowedFiles: [],
				requiredTargetFiles: [],
				changedFiles: [],
				replayHighlights: [],
				smallLaneVisible: false,
				scopeStayedBounded: false,
				artifactTruthVisible: false,
				details: [`admission=${admission.decision}`],
			}
		}

		const { result, lines } = await captureConsole(() =>
			runSwarmEngineRuntime({
				engine: "swarmengine",
				workspace: fixture.repoPath,
				dryRun: true,
				allowDirty: false,
				task,
				taskContract: admission.task.derivedTaskContract,
			}),
		)
		const summaryPath = result.summaryPath
		const summary = summaryPath ? readRunSummary(path.dirname(summaryPath)) : null
		const modeSelector = asRecord(summary?.["modeSelector"])
		const fastLane = asRecord(summary?.["fastLane"])
		const taskContract = asRecord(summary?.["taskContract"])
		const scope = asRecord(taskContract?.["scope"])
		const acceptanceGate = asRecord(summary?.["acceptanceGate"])
		const replayOverview = asRecord(summary?.["replayOverview"])
		const allowedFiles = readStringArray(scope?.["allowedFiles"])
		const requiredTargetFiles = readStringArray(scope?.["requiredTargetFiles"])
		const changedFiles = readStringArray(summary?.["changedFiles"])
		const replayHighlights = readStringArray(replayOverview?.["highlights"])
		const pathChosen = typeof summary?.["pathChosen"] === "string" ? summary["pathChosen"] : null
		const modeId = typeof modeSelector?.["modeId"] === "string" ? modeSelector["modeId"] : null
		const fastLaneId = typeof fastLane?.["laneId"] === "string" ? fastLane["laneId"] : null
		const smallLaneVisible = pathChosen === "small_task" && modeId === "low_cost_small_lane" && fastLaneId === "simple_task_fast_lane"
		const scopeStayedBounded =
			allowedFiles.join(",") === "hello.ts" &&
			requiredTargetFiles.join(",") === "hello.ts" &&
			scope?.["maxEditedFileCount"] === 1
		const artifactTruthVisible =
			Boolean(summaryPath) &&
			typeof summary?.["contextPackArtifactPath"] === "string" &&
			typeof summary?.["replayArtifactPath"] === "string" &&
			typeof summary?.["reviewerVerdict"] === "string" &&
			acceptanceGate !== null &&
			replayHighlights.length > 0

		return {
			task,
			admitted: true,
			summaryPresent: Boolean(summaryPath && summary),
			summaryPath,
			status: result.status,
			stopReason: result.stopReason,
			pathChosen,
			modeId,
			fastLaneId,
			allowedFiles,
			requiredTargetFiles,
			changedFiles,
			replayHighlights,
			smallLaneVisible,
			scopeStayedBounded,
			artifactTruthVisible,
			details: [
				`admission=${admission.decision}`,
				`console=${lines.filter(Boolean).slice(0, 6).join(" | ") || "missing"}`,
				`summaryPath=${summaryPath ?? "missing"}`,
				`status=${result.status}`,
				`stopReason=${result.stopReason}`,
				`lane=${[pathChosen, modeId, fastLaneId].filter(Boolean).join(" / ") || "missing"}`,
				`scope=${allowedFiles.join(",") || "missing"}`,
				`changedFiles=${changedFiles.join(",") || "(none)"}`,
				`replayHighlights=${replayHighlights.join(" | ") || "missing"}`,
			],
		}
	} finally {
		DatabaseService.reset()
		fixture.cleanup()
	}
}

export async function runQueenBeeSmallComparisonHarness(rootDir = resolveRootDir()): Promise<QueenBeeSmallComparisonHarnessResult> {
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const benchmarkText = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const benchmarkPlanText = readText(rootDir, "QUEENBEE_BENCHMARK_PLAN.md")
	const dailyProgramText = readText(rootDir, "QUEENBEE_DAILY_JSTS_PROGRAM.md")
	const allocationPolicyText = readText(rootDir, "QUEENBEE_ALLOCATION_POLICY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const packageScriptPresent =
		packageJson.scripts?.["benchmark:queenbee:small"] === "npm run build && node dist/verification/benchmark_queenbee_small.js"
	const comparisonDocsPresent =
		includesAll(firstSliceText, ["## Session 199 One-File Comparison Rule", "`npm.cmd run benchmark:queenbee:small`", "candidate-only"]) &&
		includesAll(
			benchmarkText,
			["## QueenBee Candidate One-File Comparison", "`npm.cmd run benchmark:queenbee:small`", "dry-run artifact lane"],
		) &&
		includesAll(
			architectureText,
			[
				"## Decision: Session 199 compares the shipped one-file swarmengine lane against the QueenBee proposal-first shell",
				"**Session:** 199",
				"## Decision: Session 276 grounds the current specialist family in one bounded daily repo task matrix",
			],
		) &&
		includesAll(benchmarkPlanText, [
			"## Session 276 Specialist Daily Repo Matrix Reading",
			"`QB-BM-08` through `QB-BM-11` now define one bounded daily repo task matrix",
			"`JSTSTestBee`, `JSTSAsyncBee`, `JSTSNodeBee`, and `JSTSRefactorBee`",
		]) &&
		includesAll(dailyProgramText, [
			"## Session 276 Specialist Daily Repo Matrix Update",
			"`QB-BM-08` through `QB-BM-11` and `QB-EX-08` through `QB-EX-11`",
			"helper/test -> `JSTSTestBee`",
		]) &&
		includesAll(allocationPolicyText, [
			"## Session 276 Daily Repo Matrix Reading",
			"`QB-BM-08` through `QB-BM-11` now form the bounded recurring repo-local matrix",
			"retry/caller -> `JSTSAsyncBee`",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run benchmark:queenbee:small`",
			"candidate-only one-file comparison",
			"the Session 276 specialist daily repo matrix now records `QB-BM-08` through `QB-BM-11`",
		])
	const comparisonStayedCandidateOnly =
		includesAll(
			benchmarkText,
			[
				"`swarmengine` remains the shipped bounded engine",
				"`queenbee` remains an experimental engine candidate",
				"not a replacement claim",
			],
		) &&
		includesAll(
			architectureText,
			[
				"`swarmengine` remains the shipped bounded engine",
				"`queenbee` remains a candidate-only protocol shell for this comparison",
			],
		)

	const swarmengine = await observeSwarmEngineSmallComparison(rootDir)
	const queenbee = await runQueenBeeJstsSmallHarness(rootDir)
	const sameTaskFamilyVisible = swarmengine.task === QUEENBEE_JSTS_SMALL_TASK && queenbee.taskText === QUEENBEE_JSTS_SMALL_TASK
	const queenbeeProtocolVisible =
		queenbee.coderDocsPresent &&
		queenbee.reverseEngineeringDocsPresent &&
		queenbee.coderEdgesImplemented &&
		queenbee.assignmentDelivered &&
		queenbee.tinyFileTruthLocked &&
		queenbee.smallRowsStaySingleWorker
	const queenbeeScopeStayedBounded =
		queenbee.proposalStayedScoped &&
		queenbee.diskStayedUnchanged &&
		queenbee.proposalPaths.includes("hello.ts") &&
		queenbee.tooWideReason === "coder_target_count_out_of_bounds"
	const details = [
		`task=${QUEENBEE_JSTS_SMALL_TASK}`,
		`swarmengineStatus=${swarmengine.status}/${swarmengine.stopReason}`,
		`swarmengineLane=${[swarmengine.pathChosen, swarmengine.modeId, swarmengine.fastLaneId].filter(Boolean).join(" / ") || "missing"}`,
		`swarmengineScope=${swarmengine.allowedFiles.join(",") || "missing"}`,
		`queenbeeProposalPaths=${queenbee.proposalPaths.join(",") || "missing"}`,
		`queenbeeCandidates=${queenbee.candidateBeeIds.join(",") || "missing"}`,
		`queenbeeAssignmentSender=${queenbee.assignmentPacketSender ?? "missing"}`,
		`queenbeeTooWideReason=${queenbee.tooWideReason ?? "missing"}`,
	]

	return {
		packageScriptPresent,
		comparisonDocsPresent,
		comparisonStayedCandidateOnly,
		sameTaskFamilyVisible,
		swarmengineTaskAdmitted: swarmengine.admitted,
		swarmengineSummaryPresent: swarmengine.summaryPresent,
		swarmengineSmallLaneVisible: swarmengine.smallLaneVisible,
		swarmengineScopeStayedBounded: swarmengine.scopeStayedBounded,
		swarmengineArtifactTruthVisible: swarmengine.artifactTruthVisible,
		queenbeeProtocolVisible,
		queenbeeScopeStayedBounded,
		swarmengine,
		queenbeeSummary: formatQueenBeeJstsSmallHarnessResult(queenbee),
		queenbeeDetails: queenbee.details,
		details,
	}
}

export function formatQueenBeeSmallComparisonHarnessResult(result: QueenBeeSmallComparisonHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Comparison docs present: ${result.comparisonDocsPresent ? "PASS" : "FAIL"}`,
		`Comparison stayed candidate-only: ${result.comparisonStayedCandidateOnly ? "PASS" : "FAIL"}`,
		`Same task family visible: ${result.sameTaskFamilyVisible ? "PASS" : "FAIL"}`,
		`Swarmengine task admitted: ${result.swarmengineTaskAdmitted ? "PASS" : "FAIL"}`,
		`Swarmengine summary present: ${result.swarmengineSummaryPresent ? "PASS" : "FAIL"}`,
		`Swarmengine small lane visible: ${result.swarmengineSmallLaneVisible ? "PASS" : "FAIL"}`,
		`Swarmengine scope stayed bounded: ${result.swarmengineScopeStayedBounded ? "PASS" : "FAIL"}`,
		`Swarmengine artifact truth visible: ${result.swarmengineArtifactTruthVisible ? "PASS" : "FAIL"}`,
		`QueenBee protocol visible: ${result.queenbeeProtocolVisible ? "PASS" : "FAIL"}`,
		`QueenBee scope stayed bounded: ${result.queenbeeScopeStayedBounded ? "PASS" : "FAIL"}`,
		`Swarmengine observed status: ${result.swarmengine.status}/${result.swarmengine.stopReason}`,
		`Swarmengine summary: ${result.swarmengine.summaryPath ?? "(missing)"}`,
		`Swarmengine lane: ${[result.swarmengine.pathChosen, result.swarmengine.modeId, result.swarmengine.fastLaneId].filter(Boolean).join(" / ") || "(missing)"}`,
		`Swarmengine scope: ${result.swarmengine.allowedFiles.join(",") || "(missing)"}`,
		`Swarmengine replay highlights: ${result.swarmengine.replayHighlights.join(" | ") || "(missing)"}`,
		`QueenBee summary: proposal-first one-file shell`,
		`QueenBee details: ${result.queenbeeDetails.join(" | ") || "(missing)"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeSmallComparisonHarness()
	console.log(formatQueenBeeSmallComparisonHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.comparisonDocsPresent &&
			result.comparisonStayedCandidateOnly &&
			result.sameTaskFamilyVisible &&
			result.swarmengineTaskAdmitted &&
			result.swarmengineSummaryPresent &&
			result.swarmengineSmallLaneVisible &&
			result.swarmengineScopeStayedBounded &&
			result.swarmengineArtifactTruthVisible &&
			result.queenbeeProtocolVisible &&
			result.queenbeeScopeStayedBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[benchmark:queenbee:small] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
