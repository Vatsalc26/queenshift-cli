import fs from "node:fs"
import path from "node:path"

import { DatabaseService } from "../src/db/DatabaseService"
import { evaluateAdmission } from "../src/run/AdmissionGate"
import { readRunSummary } from "../src/run/RunArtifacts"
import { runSwarmEngineRuntime } from "../src/swarmengine/SwarmEngineRuntime"
import { createTempTestRepoCopy } from "./test_workspace_baseline"
import {
	QUEENBEE_JSTS_TWO_FILE_TASK,
	formatQueenBeeJstsTwoFileHarnessResult,
	runQueenBeeJstsTwoFileHarness,
} from "./verify_queenbee_jsts_two_file"

type SwarmEngineTwoFileComparisonObservation = {
	task: string
	admitted: boolean
	summaryPresent: boolean
	summaryPath: string | null
	status: string
	stopReason: string
	pathChosen: string | null
	modeId: string | null
	allowedFiles: string[]
	requiredTargetFiles: string[]
	changedFiles: string[]
	replayHighlights: string[]
	scopedLaneVisible: boolean
	scopeStayedBounded: boolean
	artifactTruthVisible: boolean
	details: string[]
}

export type QueenBeeTwoFileComparisonHarnessResult = {
	packageScriptPresent: boolean
	comparisonDocsPresent: boolean
	userConfidenceReviewRecorded: boolean
	protocolValueVsCeremonyJudged: boolean
	sameTaskFamilyVisible: boolean
	swarmengineTaskAdmitted: boolean
	swarmengineSummaryPresent: boolean
	swarmengineScopedLaneVisible: boolean
	swarmengineScopeStayedBounded: boolean
	swarmengineArtifactTruthVisible: boolean
	queenbeeTwoFileLaneVisible: boolean
	queenbeeScopeStayedBounded: boolean
	queenbeeCompletionEvidenceVisible: boolean
	swarmengine: SwarmEngineTwoFileComparisonObservation
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

async function observeSwarmEngineTwoFileComparison(rootDir: string): Promise<SwarmEngineTwoFileComparisonObservation> {
	const fixture = await createTempTestRepoCopy(rootDir, "swarmengine-two-file-compare")
	try {
		DatabaseService.reset()
		const task = QUEENBEE_JSTS_TWO_FILE_TASK
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
				allowedFiles: [],
				requiredTargetFiles: [],
				changedFiles: [],
				replayHighlights: [],
				scopedLaneVisible: false,
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
		const taskContract = asRecord(summary?.["taskContract"])
		const scope = asRecord(taskContract?.["scope"])
		const replayOverview = asRecord(summary?.["replayOverview"])
		const acceptanceGate = asRecord(summary?.["acceptanceGate"])
		const allowedFiles = readStringArray(scope?.["allowedFiles"])
		const requiredTargetFiles = readStringArray(scope?.["requiredTargetFiles"])
		const changedFiles = readStringArray(summary?.["changedFiles"])
		const replayHighlights = readStringArray(replayOverview?.["highlights"])
		const pathChosen = typeof summary?.["pathChosen"] === "string" ? summary["pathChosen"] : null
		const modeId = typeof modeSelector?.["modeId"] === "string" ? modeSelector["modeId"] : null
		const scopedLaneVisible = pathChosen === "scoped" && modeId === "balanced_scoped_lane"
		const sortedAllowed = [...allowedFiles].sort().join(",")
		const sortedRequired = [...requiredTargetFiles].sort().join(",")
		const scopeStayedBounded =
			sortedAllowed === "hello.ts,utils.ts" &&
			sortedRequired === "hello.ts,utils.ts" &&
			scope?.["maxEditedFileCount"] === 2
		const artifactTruthVisible =
			Boolean(summaryPath) &&
			typeof summary?.["contextPackArtifactPath"] === "string" &&
			typeof summary?.["replayArtifactPath"] === "string" &&
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
			allowedFiles,
			requiredTargetFiles,
			changedFiles,
			replayHighlights,
			scopedLaneVisible,
			scopeStayedBounded,
			artifactTruthVisible,
			details: [
				`admission=${admission.decision}`,
				`console=${lines.filter(Boolean).slice(0, 8).join(" | ") || "missing"}`,
				`summaryPath=${summaryPath ?? "missing"}`,
				`status=${result.status}`,
				`stopReason=${result.stopReason}`,
				`lane=${[pathChosen, modeId].filter(Boolean).join(" / ") || "missing"}`,
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

export async function runQueenBeeTwoFileComparisonHarness(rootDir = resolveRootDir()): Promise<QueenBeeTwoFileComparisonHarnessResult> {
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const benchmarkText = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const uxReviewText = readText(rootDir, "QUEENBEE_UX_REVIEW_NOTES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const packageScriptPresent =
		packageJson.scripts?.["benchmark:queenbee:two-file"] === "npm run build && node dist/verification/benchmark_queenbee_two_file.js"
	const comparisonDocsPresent =
		includesAll(
			candidateText,
			["## Session 200 Two-File Confidence Review", "`npm.cmd run benchmark:queenbee:two-file`", "protocol ceremony"],
		) &&
		includesAll(
			benchmarkText,
			[
				"## QueenBee Candidate Two-File Comparison And UX Review",
				"`npm.cmd run benchmark:queenbee:two-file`",
				"Mixed confidence gain",
			],
		) &&
		includesAll(
			verificationCatalogText,
			["`npm.cmd run benchmark:queenbee:two-file`", "candidate-only two-file comparison plus UX review"],
		) &&
		includesAll(
			architectureText,
			[
				"## Decision: Session 200 judges QueenBee two-file value by confidence gained versus protocol ceremony",
				"**Session:** 200",
			],
		)
	const userConfidenceReviewRecorded =
		includesAll(
			uxReviewText,
			["## Session 200 Two-File Confidence Review", "`npm.cmd run benchmark:queenbee:two-file`", "Mixed result."],
		) &&
		includesAll(
			uxReviewText,
			["`swarmengine` stays easier to read", "`queenbee` adds useful legibility", "confidence gain is real but not yet decisive"],
		)
	const protocolValueVsCeremonyJudged = includesAll(uxReviewText, ["extra protocol ceremony", "do not widen public claims"])

	const swarmengine = await observeSwarmEngineTwoFileComparison(rootDir)
	const queenbee = await runQueenBeeJstsTwoFileHarness(rootDir)
	const sameTaskFamilyVisible = swarmengine.task === QUEENBEE_JSTS_TWO_FILE_TASK && queenbee.taskText === QUEENBEE_JSTS_TWO_FILE_TASK
	const queenbeeTwoFileLaneVisible = queenbee.twoFileDocsPresent && queenbee.twoFileProposalDelivered && queenbee.twoFileReviewDelivered
	const queenbeeScopeStayedBounded =
		queenbee.proposalPaths.slice().sort().join(",") === "hello.ts,utils.ts" && queenbee.threeFileBoundPreserved && queenbee.tooWideReason === "coder_target_count_out_of_bounds"
	const queenbeeCompletionEvidenceVisible =
		queenbee.twoFileVerificationDelivered &&
		queenbee.twoFileMergeDelivered &&
		queenbee.archiveWritten &&
		queenbee.reviewType === "review_pass" &&
		queenbee.verificationCommand === "npm.cmd run verify:lane:medium" &&
		queenbee.mergeType === "merge_pass" &&
		queenbee.archivePath === ".swarm/queenbee_archive/assign-jsts-two-file-1.json"
	const details = [
		`task=${QUEENBEE_JSTS_TWO_FILE_TASK}`,
		`swarmengineStatus=${swarmengine.status}/${swarmengine.stopReason}`,
		`swarmengineLane=${[swarmengine.pathChosen, swarmengine.modeId].filter(Boolean).join(" / ") || "missing"}`,
		`swarmengineScope=${swarmengine.allowedFiles.join(",") || "missing"}`,
		`queenbeeProposalPaths=${queenbee.proposalPaths.join(",") || "missing"}`,
		`queenbeeReviewType=${queenbee.reviewType ?? "missing"}`,
		`queenbeeVerificationCommand=${queenbee.verificationCommand ?? "missing"}`,
		`queenbeeMergeType=${queenbee.mergeType ?? "missing"}`,
		`queenbeeArchivePath=${queenbee.archivePath ?? "missing"}`,
		`queenbeeTooWideReason=${queenbee.tooWideReason ?? "missing"}`,
		`uxJudgment=mixed confidence gain; extra protocol ceremony remains`,
	]

	return {
		packageScriptPresent,
		comparisonDocsPresent,
		userConfidenceReviewRecorded,
		protocolValueVsCeremonyJudged,
		sameTaskFamilyVisible,
		swarmengineTaskAdmitted: swarmengine.admitted,
		swarmengineSummaryPresent: swarmengine.summaryPresent,
		swarmengineScopedLaneVisible: swarmengine.scopedLaneVisible,
		swarmengineScopeStayedBounded: swarmengine.scopeStayedBounded,
		swarmengineArtifactTruthVisible: swarmengine.artifactTruthVisible,
		queenbeeTwoFileLaneVisible,
		queenbeeScopeStayedBounded,
		queenbeeCompletionEvidenceVisible,
		swarmengine,
		queenbeeSummary: formatQueenBeeJstsTwoFileHarnessResult(queenbee),
		queenbeeDetails: queenbee.details,
		details,
	}
}

export function formatQueenBeeTwoFileComparisonHarnessResult(result: QueenBeeTwoFileComparisonHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Comparison docs present: ${result.comparisonDocsPresent ? "PASS" : "FAIL"}`,
		`User-confidence review recorded: ${result.userConfidenceReviewRecorded ? "PASS" : "FAIL"}`,
		`Protocol value versus ceremony judged: ${result.protocolValueVsCeremonyJudged ? "PASS" : "FAIL"}`,
		`Same task family visible: ${result.sameTaskFamilyVisible ? "PASS" : "FAIL"}`,
		`Swarmengine task admitted: ${result.swarmengineTaskAdmitted ? "PASS" : "FAIL"}`,
		`Swarmengine summary present: ${result.swarmengineSummaryPresent ? "PASS" : "FAIL"}`,
		`Swarmengine scoped lane visible: ${result.swarmengineScopedLaneVisible ? "PASS" : "FAIL"}`,
		`Swarmengine scope stayed bounded: ${result.swarmengineScopeStayedBounded ? "PASS" : "FAIL"}`,
		`Swarmengine artifact truth visible: ${result.swarmengineArtifactTruthVisible ? "PASS" : "FAIL"}`,
		`QueenBee two-file lane visible: ${result.queenbeeTwoFileLaneVisible ? "PASS" : "FAIL"}`,
		`QueenBee scope stayed bounded: ${result.queenbeeScopeStayedBounded ? "PASS" : "FAIL"}`,
		`QueenBee completion evidence visible: ${result.queenbeeCompletionEvidenceVisible ? "PASS" : "FAIL"}`,
		`UX judgment: mixed confidence gain; extra protocol ceremony remains`,
		`Swarmengine observed status: ${result.swarmengine.status}/${result.swarmengine.stopReason}`,
		`Swarmengine summary: ${result.swarmengine.summaryPath ?? "(missing)"}`,
		`Swarmengine lane: ${[result.swarmengine.pathChosen, result.swarmengine.modeId].filter(Boolean).join(" / ") || "(missing)"}`,
		`Swarmengine scope: ${result.swarmengine.allowedFiles.join(",") || "(missing)"}`,
		`Swarmengine replay highlights: ${result.swarmengine.replayHighlights.join(" | ") || "(missing)"}`,
		`QueenBee summary: full two-file proposal/review/verify/merge/archive shell`,
		`QueenBee details: ${result.queenbeeDetails.join(" | ") || "(missing)"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeTwoFileComparisonHarness()
	console.log(formatQueenBeeTwoFileComparisonHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.comparisonDocsPresent &&
			result.userConfidenceReviewRecorded &&
			result.protocolValueVsCeremonyJudged &&
			result.sameTaskFamilyVisible &&
			result.swarmengineTaskAdmitted &&
			result.swarmengineSummaryPresent &&
			result.swarmengineScopedLaneVisible &&
			result.swarmengineScopeStayedBounded &&
			result.swarmengineArtifactTruthVisible &&
			result.queenbeeTwoFileLaneVisible &&
			result.queenbeeScopeStayedBounded &&
			result.queenbeeCompletionEvidenceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[benchmark:queenbee:two-file] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
