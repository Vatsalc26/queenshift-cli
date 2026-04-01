import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import type { TaskEngineRunContext, TaskEngineRunResult } from "../engine/EngineRuntimeTypes"
import { resolveOwnerProviderSelection } from "../owner/ProviderResolution"
import { ensureRunDir, writeRunSummary } from "../run/RunArtifacts"
import { extractTaskFileRefs } from "../run/TaskContract"
import { SUPPORTED_JS_TS_EXTENSIONS } from "./JSTSCoreBee"
import type { QueenBeeCoderSpecialistName } from "./JSTSCoderBee"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope, type QueenBeeTaskFamily, type QueenBeeVisibleProgressStage, type QueenBeeVisibleQueueName } from "./QueenBeeProtocol"
import { createQueenBeeShell } from "./QueenBeeShell"
import type { QueenBeeVerificationResultRow, QueenBeeVerifierExecutor } from "./VerifierBee"

const QUEENBEE_BETA_FAMILIES = [
	"comment_file",
	"update_named_file",
	"bounded_two_file_update",
	"update_file_and_test",
	"rename_export",
	"bounded_node_cli_task",
] as const
const TEST_FILE_PATTERN = /(^|\/)__tests__(\/|$)|(?:\.|_)test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/u
const NODE_TASK_SIGNAL_PATTERN = /(package\.json|process\.env|process\.argv|child_process|\bnpm run\b|\bcli\b|\bargv\b|\bstdin\b|\bstdout\b|\bstderr\b|commander|yargs)/iu
const FIRST_CANONICAL_PROOF_COMMANDS = ["npm.cmd test"] as const
const FIRST_GATEWAY_PROOF_COMMANDS = ["npm.cmd test"] as const

type QueenBeeCandidateProgressSnapshot = {
	schemaVersion: 1
	engine: "queenbee"
	status: "candidate_not_ready"
	confidenceOutcome: "candidate_preview_only"
	stopReason: "candidate_engine_not_ready"
	taskFamilyHint: QueenBeeTaskFamily | null
	allowedFiles: string[]
	activeQueue: QueenBeeVisibleQueueName
	currentStage: QueenBeeVisibleProgressStage
	missionId: string
	assignmentId: string | null
	selectedSpecialist: QueenBeeCoderSpecialistName | null
	stageStartedAt: string
	lastEventAt: string
	nextTimeoutAt: string | null
	ttlExpiresAt: string | null
	nextExpectedHandoff: string
	executionAttempted: false
	artifactWrittenAt: string
}

type QueenBeeLiveSpec = {
	rowId: "QB-LIVE-01" | "QB-LIVE-02" | "QB-LIVE-04" | "QB-LIVE-05" | "QB-LIVE-06" | "QB-LIVE-GW-01"
	rowLabel:
		| "first canonical live row"
		| "named-file canonical live row"
		| "file-and-test canonical live row"
		| "rename canonical live row"
		| "node canonical live row"
		| "first live gateway row"
	canonicalRowId: "QB-CAN-01" | "QB-CAN-03" | "QB-CAN-05" | "QB-CAN-04" | "QB-CAN-07"
	gatewayRowId: "QB-GW-01" | null
	verificationProfileName: "queenbee_live_first_canonical" | "queenbee_live_gateway"
	verificationRouteLabel: "queenbee_live_first_canonical_repo_test" | "queenbee_live_gateway_repo_test"
	family: "comment_file" | "update_named_file" | "update_file_and_test" | "rename_export" | "bounded_node_cli_task"
	files: [string] | [string, string] | [string, string, string]
	proofCommands: string[]
	requiresScout: boolean
	allowedLiveSpecialists: readonly QueenBeeCoderSpecialistName[]
	assignmentIdPrefix:
		| "qb-live-comment"
		| "qb-live-update"
		| "qb-live-file-and-test"
		| "qb-live-rename"
		| "qb-live-node"
		| "qb-live-gateway"
}

type QueenBeeLiveRunRecord = {
	taskId: string
	runDir: string
	summaryPath: string
	missionId: string
	assignmentId: string
	rowId: QueenBeeLiveSpec["rowId"]
	rowLabel: QueenBeeLiveSpec["rowLabel"]
	canonicalRowId: QueenBeeLiveSpec["canonicalRowId"]
	gatewayRowId: QueenBeeLiveSpec["gatewayRowId"]
	verificationProfileName: QueenBeeLiveSpec["verificationProfileName"]
	taskFamily: QueenBeeLiveSpec["family"]
	selectedSpecialist: QueenBeeCoderSpecialistName
	changedFiles: string[]
	archivePath: string | null
	providerName: string
	modelName: string
	providerCallObserved: boolean
	proofCommands: string[]
	artifactRefs: Record<string, string>
}

type QueenBeeCommitArtifact = {
	commitAttempted: boolean
	committed: boolean
	commitMessage: string
	dirtyBefore: string[]
	dirtyAfter: string[]
	addExitCode: number | null
	commitExitCode: number | null
	addOutputSummary: string
	commitOutputSummary: string
}

function isLikelyTestFile(filePath: string): boolean {
	const normalized = filePath.replace(/[\\/]+/g, "/").toLowerCase()
	return TEST_FILE_PATTERN.test(normalized)
}

function orderSourceBeforeTest(files: string[]): string[] {
	return [...files].sort((left, right) => {
		const leftRank = isLikelyTestFile(left) ? 1 : 0
		const rightRank = isLikelyTestFile(right) ? 1 : 0
		return leftRank - rightRank || left.localeCompare(right)
	})
}

function normalizeRelPath(input: string): string {
	return input.replace(/[\\/]+/g, "/").replace(/^\.\/+/, "").trim()
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => normalizeRelPath(item)).filter(Boolean)))
		: []
}

function hasSameNormalizedFileSet(left: string[], right: string[]): boolean {
	const leftSet = new Set(left.map((value) => normalizeRelPath(value)).filter(Boolean))
	const rightSet = new Set(right.map((value) => normalizeRelPath(value)).filter(Boolean))
	if (leftSet.size !== rightSet.size) return false
	for (const value of leftSet) {
		if (!rightSet.has(value)) return false
	}
	return true
}

function inferCandidateTaskHint(context: TaskEngineRunContext): { family: QueenBeeTaskFamily | null; files: string[] } {
	const scopedFiles = context.taskContract?.scope?.allowedFiles ?? []
	const files = scopedFiles.length > 0 ? scopedFiles : extractTaskFileRefs(context.task)
	const taskLower = context.task.trim().toLowerCase()
	const derivationClass = context.taskContract?.derivation?.taskClass

	if (taskLower.startsWith("create ") && files.length === 1) {
		return { family: "create_tiny_file", files }
	}
	if (
		derivationClass === "helper_test" ||
		taskLower.includes("keep its test aligned") ||
		taskLower.includes("keep its direct local test aligned")
	) {
		return { family: "update_file_and_test", files: orderSourceBeforeTest(files) }
	}
	if (derivationClass === "rename_export" || taskLower.startsWith("rename the export in ")) {
		return { family: "rename_export", files }
	}
	if (files.length === 2) {
		const testFileCount = files.filter((filePath) => isLikelyTestFile(filePath)).length
		if (testFileCount === 1) {
			return { family: "update_file_and_test", files: orderSourceBeforeTest(files) }
		}
	}
	if (NODE_TASK_SIGNAL_PATTERN.test(`${context.task}\n${files.join("\n")}`)) {
		return { family: "bounded_node_cli_task", files }
	}
	if (files.length === 2) {
		return { family: "bounded_two_file_update", files }
	}
	if (/\bcomment\b/iu.test(context.task) && files.length === 1) {
		return { family: "comment_file", files }
	}
	if (files.length === 1) {
		return { family: "update_named_file", files }
	}
	return { family: null, files }
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
	const base = Date.parse(timestamp)
	return Number.isNaN(base) ? timestamp : new Date(base + milliseconds).toISOString()
}

function resolveCandidateProgressArtifactPath(workspace: string): string {
	return path.join(workspace, ".swarm", "queenbee-candidate", "latest-progress.json")
}

function removeCandidateProgressSnapshot(workspace: string): void {
	const artifactPath = resolveCandidateProgressArtifactPath(workspace)
	if (!fs.existsSync(artifactPath)) return
	fs.rmSync(artifactPath, { force: true })
}

function buildCandidateProgressSnapshot(context: TaskEngineRunContext): QueenBeeCandidateProgressSnapshot {
	const shell = createQueenBeeShell({ workspaceRoot: context.workspace })
	const hint = inferCandidateTaskHint(context)
	const lastEventAt = new Date().toISOString()
	const missionId = `qb-preview-mission-${Date.now()}`
	const assignmentId = hint.family ? `qb-preview-${hint.family}` : null

	let activeQueue: QueenBeeVisibleQueueName = "service_queue"
	let currentStage: QueenBeeVisibleProgressStage = "planning"
	let selectedSpecialist: QueenBeeCoderSpecialistName | null = null
	let nextTimeoutAt: string | null = addMilliseconds(lastEventAt, 90_000)
	let nextExpectedHandoff = "bounded family selection or refusal"

	if (hint.family && hint.files.length > 0) {
		const previewEnvelope = buildQueenBeeEnvelope({
			messageId: `${missionId}:assignment-preview`,
			missionId,
			assignmentId,
			senderBeeId: "queenbee.planner.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: lastEventAt,
			payload: {
				task: context.task,
				taskFamily: hint.family,
				languagePack: "js_ts",
				allowedFiles: hint.files,
			},
		})
		selectedSpecialist = shell.coder.selectSpecialistForEnvelope(previewEnvelope)
		activeQueue = "specialist_queue"
		currentStage = "proposal"
		nextTimeoutAt = addMilliseconds(lastEventAt, 300_000)
		nextExpectedHandoff = `proposal via ${selectedSpecialist}, but the candidate runtime stops before live execution`
	}

	return {
		schemaVersion: 1,
		engine: "queenbee",
		status: "candidate_not_ready",
		confidenceOutcome: "candidate_preview_only",
		stopReason: "candidate_engine_not_ready",
		taskFamilyHint: hint.family,
		allowedFiles: hint.files,
		activeQueue,
		currentStage,
		missionId,
		assignmentId,
		selectedSpecialist,
		stageStartedAt: lastEventAt,
		lastEventAt,
		nextTimeoutAt,
		ttlExpiresAt: null,
		nextExpectedHandoff,
		executionAttempted: false,
		artifactWrittenAt: lastEventAt,
	}
}

function writeCandidateProgressSnapshot(workspace: string, snapshot: QueenBeeCandidateProgressSnapshot): string {
	const artifactPath = resolveCandidateProgressArtifactPath(workspace)
	fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
	fs.writeFileSync(artifactPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
	return artifactPath
}

function resolveControlRepoRoot(): string {
	const candidates = [
		path.resolve(__dirname, "..", ".."),
		path.resolve(__dirname, "..", "..", ".."),
		process.cwd(),
	]
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, "package.json")) && fs.existsSync(path.join(candidate, "scripts"))) {
			return candidate
		}
	}
	return process.cwd()
}

function summarizeProcessOutput(stdout: string, stderr: string): string {
	const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
	if (!combined) return "(no output)"
	return combined.length > 600 ? combined.slice(-600) : combined
}

function createFirstCanonicalVerifierExecutor(controlRepoRoot: string): QueenBeeVerifierExecutor {
	return ({ command }) => {
		const result = spawnSync(command, {
			cwd: controlRepoRoot,
			windowsHide: true,
			shell: true,
			encoding: "utf8",
			timeout: 900_000,
		})
		const exitCode = typeof result.status === "number" ? result.status : 1
		return {
			command,
			exitCode,
			passed: exitCode === 0,
			outputSummary: summarizeProcessOutput(result.stdout ?? "", result.stderr ?? ""),
		}
	}
}

function readGitStatusEntries(workspace: string): string[] {
	const result = spawnSync("git", ["-c", `safe.directory=${workspace}`, "status", "--porcelain", "--untracked-files=all"], {
		cwd: workspace,
		windowsHide: true,
		encoding: "utf8",
		timeout: 30_000,
	})
	if (result.status !== 0) {
		return [`git status failed: ${summarizeProcessOutput(result.stdout ?? "", result.stderr ?? "")}`]
	}
	return (result.stdout ?? "")
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean)
}

function commitMergedChanges(workspace: string, task: string): QueenBeeCommitArtifact {
	const commitMessage = `queenbee: ${task.trim().slice(0, 72)}`
	const dirtyBefore = readGitStatusEntries(workspace)
	if (dirtyBefore.length === 0) {
		return {
			commitAttempted: false,
			committed: true,
			commitMessage,
			dirtyBefore,
			dirtyAfter: [],
			addExitCode: null,
			commitExitCode: null,
			addOutputSummary: "(no changes to stage)",
			commitOutputSummary: "(no commit needed)",
		}
	}

	const addResult = spawnSync("git", ["-c", `safe.directory=${workspace}`, "add", "-A"], {
		cwd: workspace,
		windowsHide: true,
		encoding: "utf8",
		timeout: 30_000,
	})
	const commitResult =
		addResult.status === 0
			? spawnSync("git", ["-c", `safe.directory=${workspace}`, "commit", "-m", commitMessage], {
					cwd: workspace,
					windowsHide: true,
					encoding: "utf8",
					timeout: 30_000,
			  })
			: null
	const dirtyAfter = readGitStatusEntries(workspace)

	return {
		commitAttempted: true,
		committed: addResult.status === 0 && commitResult?.status === 0 && dirtyAfter.length === 0,
		commitMessage,
		dirtyBefore,
		dirtyAfter,
		addExitCode: typeof addResult.status === "number" ? addResult.status : null,
		commitExitCode: typeof commitResult?.status === "number" ? commitResult.status : null,
		addOutputSummary: summarizeProcessOutput(addResult.stdout ?? "", addResult.stderr ?? ""),
		commitOutputSummary: commitResult ? summarizeProcessOutput(commitResult.stdout ?? "", commitResult.stderr ?? "") : "(commit skipped)",
	}
}

function readCandidateBeeIds(envelope: QueenBeeEnvelope | null): string[] {
	const payload = asRecord(envelope?.payload)
	return readStringArray(payload?.["candidateBeeIds"])
}

function readFirstAssignmentPacket(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope | null {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return null
	const firstPacket = payload["assignmentPackets"][0]
	return firstPacket && typeof firstPacket === "object" && !Array.isArray(firstPacket) ? (firstPacket as QueenBeeEnvelope) : null
}

function writeJsonArtifact(runDir: string, fileName: string, value: unknown): string {
	const artifactPath = path.join(runDir, fileName)
	fs.writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
	return artifactPath
}

function writeTextArtifact(runDir: string, fileName: string, value: string): string {
	const artifactPath = path.join(runDir, fileName)
	fs.writeFileSync(artifactPath, value.endsWith("\n") ? value : `${value}\n`, "utf8")
	return artifactPath
}

function relativeToWorkspace(workspace: string, absolutePath: string): string {
	return path.relative(workspace, absolutePath).replace(/[\\/]+/g, "/")
}

function isSupportedLiveTarget(targetFile: string): boolean {
	const normalized = normalizeRelPath(targetFile)
	return normalized === "package.json" || SUPPORTED_JS_TS_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

function canonicalLiveSpecs(): QueenBeeLiveSpec[] {
	return [
		{
			rowId: "QB-LIVE-01",
			rowLabel: "first canonical live row",
			canonicalRowId: "QB-CAN-01",
			gatewayRowId: null,
			verificationProfileName: "queenbee_live_first_canonical",
			verificationRouteLabel: "queenbee_live_first_canonical_repo_test",
			family: "comment_file",
			files: ["src/retry.ts"],
			proofCommands: [...FIRST_CANONICAL_PROOF_COMMANDS],
			requiresScout: false,
			allowedLiveSpecialists: ["JSTSCoreBee", "JSTSAsyncBee"],
			assignmentIdPrefix: "qb-live-comment",
		},
		{
			rowId: "QB-LIVE-02",
			rowLabel: "named-file canonical live row",
			canonicalRowId: "QB-CAN-03",
			gatewayRowId: null,
			verificationProfileName: "queenbee_live_first_canonical",
			verificationRouteLabel: "queenbee_live_first_canonical_repo_test",
			family: "update_named_file",
			files: ["utils.ts"],
			proofCommands: [...FIRST_CANONICAL_PROOF_COMMANDS],
			requiresScout: false,
			allowedLiveSpecialists: ["JSTSCoreBee"],
			assignmentIdPrefix: "qb-live-update",
		},
		{
			rowId: "QB-LIVE-04",
			rowLabel: "file-and-test canonical live row",
			canonicalRowId: "QB-CAN-05",
			gatewayRowId: null,
			verificationProfileName: "queenbee_live_first_canonical",
			verificationRouteLabel: "queenbee_live_first_canonical_repo_test",
			family: "update_file_and_test",
			files: ["src/format.ts", "src/format.test.ts"],
			proofCommands: [...FIRST_CANONICAL_PROOF_COMMANDS],
			requiresScout: false,
			allowedLiveSpecialists: ["JSTSTestBee"],
			assignmentIdPrefix: "qb-live-file-and-test",
		},
		{
			rowId: "QB-LIVE-05",
			rowLabel: "rename canonical live row",
			canonicalRowId: "QB-CAN-04",
			gatewayRowId: null,
			verificationProfileName: "queenbee_live_first_canonical",
			verificationRouteLabel: "queenbee_live_first_canonical_repo_test",
			family: "rename_export",
			files: ["format.ts", "hello.ts", "utils.ts"],
			proofCommands: [...FIRST_CANONICAL_PROOF_COMMANDS],
			requiresScout: false,
			allowedLiveSpecialists: ["JSTSCoreBee"],
			assignmentIdPrefix: "qb-live-rename",
		},
		{
			rowId: "QB-LIVE-06",
			rowLabel: "node canonical live row",
			canonicalRowId: "QB-CAN-07",
			gatewayRowId: null,
			verificationProfileName: "queenbee_live_first_canonical",
			verificationRouteLabel: "queenbee_live_first_canonical_repo_test",
			family: "bounded_node_cli_task",
			files: ["package.json", "hello.ts"],
			proofCommands: [...FIRST_CANONICAL_PROOF_COMMANDS],
			requiresScout: false,
			allowedLiveSpecialists: ["JSTSNodeBee"],
			assignmentIdPrefix: "qb-live-node",
		},
	]
}

function resolveCanonicalLiveSpec(context: TaskEngineRunContext): QueenBeeLiveSpec | null {
	if (context.dryRun) return null
	const hint = inferCandidateTaskHint(context)
	const normalizedTask = context.task.trim()
	const normalizedHintFiles = hint.files.map((filePath) => normalizeRelPath(filePath))
	for (const spec of canonicalLiveSpecs()) {
		if (hint.family !== spec.family) continue
		if (!hasSameNormalizedFileSet(normalizedHintFiles, spec.files)) continue
		switch (spec.rowId) {
			case "QB-LIVE-01":
				if (normalizedTask !== 'add the exact comment "// queenbee: async retry live" to src/retry.ts') {
					continue
				}
				break
			case "QB-LIVE-02":
				if (normalizedTask !== 'update utils.ts so it includes the exact text "// queenbee: named utils"') {
					continue
				}
				break
			case "QB-LIVE-04":
				if (normalizedTask !== 'update src/format.ts and src/format.test.ts so both files include the exact comment "// queenbee: file and test".') {
					continue
				}
				break
			case "QB-LIVE-05":
				if (normalizedTask !== "rename the export in format.ts to formatValue and update its direct call sites in hello.ts and utils.ts") {
					continue
				}
				break
			case "QB-LIVE-06":
				if (normalizedTask !== 'add the exact comment "// queenbee: node cli hello" to hello.ts and add a npm run cli entry in package.json') {
					continue
				}
				break
			default:
				break
		}
		if (spec.files.some((targetFile) => !isSupportedLiveTarget(targetFile))) {
			continue
		}
		if (
			spec.files.some((targetFile) => {
				const targetPath = path.join(context.workspace, targetFile)
				return !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()
			})
		) {
			continue
		}
		return {
			...spec,
			files: [...spec.files] as QueenBeeLiveSpec["files"],
		}
	}
	return null
}

function resolveFirstGatewayLiveSpec(context: TaskEngineRunContext): QueenBeeLiveSpec | null {
	if (context.dryRun) return null
	if (context.taskContract?.derivation?.taskClass !== "helper_test") return null
	if (context.task.trim() !== 'update src/format.ts and keep its test aligned so both files include the exact comment "// queenbee: gateway helper"') {
		return null
	}
	const scopedFiles = orderSourceBeforeTest(context.taskContract?.scope?.allowedFiles ?? [])
	if (scopedFiles.length !== 2) return null
	if (scopedFiles.filter((filePath) => isLikelyTestFile(filePath)).length !== 1) return null
	const normalizedFiles = scopedFiles.map((filePath) => normalizeRelPath(filePath))
	if (normalizedFiles.some((filePath) => !filePath)) return null
	for (const targetFile of normalizedFiles) {
		const extension = path.extname(targetFile).toLowerCase()
		if (!SUPPORTED_JS_TS_EXTENSIONS.has(extension)) return null
		const targetPath = path.join(context.workspace, targetFile)
		if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return null
	}
	return {
		rowId: "QB-LIVE-GW-01",
		rowLabel: "first live gateway row",
		canonicalRowId: "QB-CAN-05",
		gatewayRowId: "QB-GW-01",
		verificationProfileName: "queenbee_live_gateway",
		verificationRouteLabel: "queenbee_live_gateway_repo_test",
		family: "update_file_and_test",
		files: [normalizedFiles[0]!, normalizedFiles[1]!],
		proofCommands: [...FIRST_GATEWAY_PROOF_COMMANDS],
		requiresScout: true,
		allowedLiveSpecialists: ["JSTSCoreBee", "JSTSTestBee"],
		assignmentIdPrefix: "qb-live-gateway",
	}
}

export function formatQueenBeeCandidateBoundaryMessage(context: TaskEngineRunContext): string {
	const hint = inferCandidateTaskHint(context)
	const snapshot = buildCandidateProgressSnapshot(context)
	const artifactPath = writeCandidateProgressSnapshot(context.workspace, snapshot)
	const hintSuffix = hint.files.length > 0 ? ` over ${hint.files.join(", ")}` : ""
	return [
		"QueenBee candidate runtime selected.",
		"`queenbee` remains experimental. `swarmengine` remains the shipped bounded engine.",
		`Current bounded beta families: ${QUEENBEE_BETA_FAMILIES.join(", ")}.`,
		hint.family ? `Current bounded candidate hint: ${hint.family}${hintSuffix}.` : "Current bounded candidate hint: no bounded family match was derived for this task.",
		hint.files.length > 0 ? `Preview scope: ${hint.files.join(", ")}.` : "Preview scope: no bounded file set could be derived.",
		"Timestamped progress preview:",
		`Preview headline: ${snapshot.currentStage} in ${snapshot.activeQueue}; next ${snapshot.nextExpectedHandoff}.`,
		`Preview stage: ${snapshot.currentStage} (${snapshot.activeQueue}).`,
		`Preview mission: ${snapshot.missionId}.`,
		snapshot.assignmentId ? `Preview assignment: ${snapshot.assignmentId}.` : "Preview assignment: not created yet.",
		snapshot.selectedSpecialist ? `Selected specialist: ${snapshot.selectedSpecialist}.` : "Selected specialist: not selected yet.",
		`Stage started: ${snapshot.stageStartedAt}.`,
		`Last event: ${snapshot.lastEventAt}.`,
		snapshot.nextTimeoutAt ? `Next timeout: ${snapshot.nextTimeoutAt}.` : "Next timeout: not active.",
		`Confidence outcome: ${snapshot.confidenceOutcome}.`,
		`Next truthful handoff: ${snapshot.nextExpectedHandoff}.`,
		`Progress artifact: ${artifactPath}.`,
		"No live coding, review, verification, or merge was executed on this candidate path.",
		'Use `--engine swarmengine` (or omit `--engine`) for the shipped bounded engine path.',
	].join("\n")
}

function inferProviderStopReason(error: unknown): string {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	if (message.includes("timed out")) return "provider_timeout"
	if (message.includes("empty response")) return "provider_empty_response"
	if (message.includes("malformed") || message.includes("json")) return "provider_malformed_response"
	if (message.includes("missing") || message.includes("oauth") || message.includes("api key") || message.includes("access token")) {
		return "provider_auth_failure"
	}
	return "provider_transport_failure"
}

function buildLiveMessage(
	workspace: string,
	record: QueenBeeLiveRunRecord,
	outcome: { status: "done" | "failed"; stopReason: string; detail: string },
): string {
	return [
		outcome.status === "done" ? `QueenBee ${record.rowLabel} completed.` : `QueenBee ${record.rowLabel} failed.`,
		"`queenbee` remains experimental. `swarmengine` remains the shipped bounded engine.",
		`Live row: ${record.rowId} (${record.taskFamily}) over ${record.changedFiles.join(", ")}.`,
		`Canonical row: ${record.canonicalRowId}.`,
		record.gatewayRowId ? `Gateway row: ${record.gatewayRowId}.` : "Gateway row: none.",
		`Selected specialist: ${record.selectedSpecialist}.`,
		`Provider: ${record.providerName}/${record.modelName}.`,
		`Provider call observed: ${record.providerCallObserved ? "yes" : "no"}.`,
		`Proof commands: ${record.proofCommands.join(", ")}.`,
		`Archive artifact: ${record.archivePath ?? "(not written)"}.`,
		`Summary artifact: ${relativeToWorkspace(workspace, record.summaryPath)}.`,
		`Outcome: ${outcome.stopReason}.`,
		outcome.detail,
	].join("\n")
}

function writeLiveSummary(
	context: TaskEngineRunContext,
	record: Omit<QueenBeeLiveRunRecord, "summaryPath">,
	input: {
		status: "done" | "failed"
		stopReason: string
		message: string
		verificationResults: QueenBeeVerificationResultRow[]
		verificationStatus: "passed" | "failed"
	}
): string {
	const summaryPath = writeRunSummary(record.runDir, {
		taskId: record.taskId,
		task: context.task,
		workspace: context.workspace,
		engine: "queenbee",
		dryRun: context.dryRun,
		allowDirty: context.allowDirty,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		status: input.status,
		stopReason: input.stopReason,
		message: input.message,
		taskContract: context.taskContract,
		verificationProfile: {
			profileName: record.verificationProfileName,
			status: input.verificationStatus,
			message:
				input.verificationStatus === "passed"
					? `QueenBee cleared ${record.proofCommands.length} bounded live proof command(s).`
					: `QueenBee recorded a bounded live proof failure for ${record.proofCommands.join(", ")}.`,
			results: input.verificationResults,
		},
		provider: {
			provider: record.providerName,
			model: record.modelName,
			providerCallObserved: record.providerCallObserved,
		},
		queenbeeLive: {
			rowId: record.rowId,
			canonicalRowId: record.canonicalRowId,
			gatewayRowId: record.gatewayRowId,
			missionId: record.missionId,
			assignmentId: record.assignmentId,
			selectedSpecialist: record.selectedSpecialist,
			taskFamily: record.taskFamily,
			changedFiles: record.changedFiles,
			proofCommands: record.proofCommands,
			archivePath: record.archivePath,
			artifactRefs: record.artifactRefs,
		},
	})
	return summaryPath
}

async function runBoundedLiveRow(context: TaskEngineRunContext, spec: QueenBeeLiveSpec): Promise<TaskEngineRunResult> {
	removeCandidateProgressSnapshot(context.workspace)
	const providerSelection = resolveOwnerProviderSelection(process.env)
	if (!providerSelection.provider || !providerSelection.ready || !providerSelection.model) {
		return {
			engine: "queenbee",
			status: "candidate_not_ready",
			stopReason: "candidate_engine_not_ready",
			message: `${formatQueenBeeCandidateBoundaryMessage(context)}\nProvider not ready for ${spec.rowLabel}: ${providerSelection.reason}`,
			summaryPath: null,
		}
	}

	const controlRepoRoot = resolveControlRepoRoot()
	const verifierExecutor = createFirstCanonicalVerifierExecutor(controlRepoRoot)
	const shell = createQueenBeeShell({ workspaceRoot: context.workspace, verifierExecutor })
	const startedAt = new Date().toISOString()
	const taskId = `queenbee-live-${Date.now()}`
	const missionId = `qb-live-mission-${Date.now()}`
	const assignmentId = `${spec.assignmentIdPrefix}-${Date.now()}`
	const runDir = ensureRunDir(context.workspace, taskId)
	const artifactRefs: Record<string, string> = {}
	const proofCommands = [...spec.proofCommands]
	let selectedSpecialist: QueenBeeCoderSpecialistName = "JSTSCoreBee"
	let archivePath: string | null = null
	let providerCallObserved = false
	let verificationResults: QueenBeeVerificationResultRow[] = []
	let summaryPath = ""
	const baseRecord = {
		taskId,
		runDir,
		missionId,
		assignmentId,
		rowId: spec.rowId,
		rowLabel: spec.rowLabel,
		canonicalRowId: spec.canonicalRowId,
		gatewayRowId: spec.gatewayRowId,
		verificationProfileName: spec.verificationProfileName,
		taskFamily: spec.family,
		changedFiles: [...spec.files],
		providerName: providerSelection.provider,
		modelName: providerSelection.model,
		proofCommands,
	}

	const finalize = (input: {
		status: "done" | "failed"
		stopReason: string
		detail: string
		verificationStatus: "passed" | "failed"
	}): TaskEngineRunResult => {
		const liveRecord = {
			...baseRecord,
			selectedSpecialist,
			archivePath,
			providerCallObserved,
			artifactRefs: { ...artifactRefs },
		}
		const draftSummaryPath = path.join(runDir, "summary.json")
		const draftMessage = buildLiveMessage(
			context.workspace,
			{
				...liveRecord,
				summaryPath: draftSummaryPath,
			},
			{ status: input.status, stopReason: input.stopReason, detail: input.detail },
		)
		summaryPath = writeLiveSummary(
			context,
			{
				...liveRecord,
			},
			{
				status: input.status,
				stopReason: input.stopReason,
				message: draftMessage,
				verificationResults,
				verificationStatus: input.verificationStatus,
			},
		)
		return {
			engine: "queenbee",
			status: input.status,
			stopReason: input.stopReason,
			message: buildLiveMessage(
				context.workspace,
				{
					...liveRecord,
					summaryPath,
				},
				{ status: input.status, stopReason: input.stopReason, detail: input.detail },
			),
			summaryPath,
		}
	}

	let reservedBeeId = ""
	try {
		const lookupResult = shell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: `${missionId}:registry_lookup`,
				missionId,
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "registry_lookup_request",
				timestamp: startedAt,
				payload: {
					desiredRoleFamily: "coder",
					desiredLanguagePack: "js_ts",
					requiredToolFamilies: ["repo_edit"],
				},
			}),
		)
		artifactRefs["registryLookup"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-registry-lookup.json", lookupResult))
		const candidateBeeIds = readCandidateBeeIds(lookupResult.responseEnvelope)
		reservedBeeId = candidateBeeIds[0] ?? ""
		if (lookupResult.status !== "delivered" || !reservedBeeId) {
			return finalize({
				status: "failed",
				stopReason: "queenbee_registry_lookup_failed",
				detail: `QueenBee could not reserve the bounded single-worker coder slot for the ${spec.rowLabel}.`,
				verificationStatus: "failed",
			})
		}

		const reserveResult = shell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: `${missionId}:bee_reserve`,
				missionId,
				assignmentId,
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.registry.001",
				messageType: "bee_reserve_request",
				timestamp: startedAt,
				payload: {
					targetBeeId: reservedBeeId,
					assignmentId,
				},
			}),
		)
		artifactRefs["reservation"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-reservation.json", reserveResult))
		if (asRecord(reserveResult.responseEnvelope?.payload)?.["reserved"] !== true) {
			return finalize({
				status: "failed",
				stopReason: "queenbee_reservation_failed",
				detail: "QueenBee failed to reserve the bounded single-worker coder slot.",
				verificationStatus: "failed",
			})
		}

		let plannedFiles = [...spec.files]
		if (spec.requiresScout) {
			const scoutResult = shell.router.routeEnvelope(
				buildQueenBeeEnvelope({
					messageId: `${missionId}:scout_request`,
					missionId,
					assignmentId,
					senderBeeId: "queenbee.router.001",
					recipientBeeId: "queenbee.scout.001",
					messageType: "scout_request",
					timestamp: startedAt,
					payload: {
						task: context.task,
						workspace: context.workspace,
						languagePack: "js_ts",
					},
				}),
			)
			artifactRefs["scoutResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-scout-result.json", scoutResult))
			const scoutPayload = asRecord(scoutResult.responseEnvelope?.payload)
			const scoutTargets = orderSourceBeforeTest(readStringArray(scoutPayload?.["targetFiles"]))
			if (scoutResult.status !== "delivered" || scoutPayload?.["accepted"] !== true || !hasSameNormalizedFileSet(scoutTargets, spec.files)) {
				return finalize({
					status: "failed",
					stopReason: "queenbee_scout_failed",
					detail: "QueenBee ScoutBee did not compile the bounded helper/test gateway scope into the expected source-plus-test pair.",
					verificationStatus: "failed",
				})
			}
			plannedFiles = scoutTargets
		}

		const planResult = shell.router.routeEnvelope(
			buildQueenBeeEnvelope({
				messageId: `${missionId}:plan_request`,
				missionId,
				assignmentId,
				senderBeeId: "queenbee.router.001",
				recipientBeeId: "queenbee.planner.001",
				messageType: "plan_request",
				timestamp: startedAt,
				payload: {
					task: context.task,
					taskFamily: spec.family,
					targetFiles: plannedFiles,
					languagePack: "js_ts",
					protectedFiles: ["package.json"],
					reservedBeeId,
				},
			}),
		)
		artifactRefs["planResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-plan-result.json", planResult))
		const assignmentPacket = readFirstAssignmentPacket(planResult.responseEnvelope)
		if (planResult.status !== "delivered" || !assignmentPacket) {
			return finalize({
				status: "failed",
				stopReason: "queenbee_plan_failed",
				detail: `QueenBee failed to compile the ${spec.rowLabel} into one bounded assignment packet.`,
				verificationStatus: "failed",
			})
		}
		selectedSpecialist = shell.coder.selectSpecialistForEnvelope(assignmentPacket)
		if (!spec.allowedLiveSpecialists.includes(selectedSpecialist)) {
			return finalize({
				status: "failed",
				stopReason: "queenbee_live_specialist_mismatch",
				detail: `QueenBee selected ${selectedSpecialist} for ${spec.rowId}, but the current bounded live row only enables provider-backed execution through ${spec.allowedLiveSpecialists.join(", ")}.`,
				verificationStatus: "failed",
			})
		}

		const liveCodeResult = await shell.coder.codeAssignmentLive(assignmentPacket, {
			...process.env,
			...providerSelection.envOverrides,
		})
		providerCallObserved = liveCodeResult.providerCallObserved
		if (!liveCodeResult.workResult.accepted) {
			return finalize({
				status: "failed",
				stopReason: String(liveCodeResult.workResult.reason ?? "queenbee_live_coder_refusal"),
				detail: liveCodeResult.workResult.coderSummary,
				verificationStatus: "failed",
			})
		}

		const workResultEnvelope = buildQueenBeeEnvelope({
			messageId: `${assignmentPacket.messageId}:work_result`,
			missionId,
			assignmentId,
			senderBeeId: "queenbee.jsts_coder.001",
			recipientBeeId: "queenbee.router.001",
			messageType: "work_result",
			timestamp: new Date().toISOString(),
			scopeToken: assignmentPacket.scopeToken,
			toolGrantToken: assignmentPacket.toolGrantToken,
			parentMessageId: assignmentPacket.messageId,
			payload: liveCodeResult.workResult as unknown as Record<string, unknown>,
		})
		shell.router.routeEnvelope(workResultEnvelope)
		artifactRefs["workResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-work-result.json", workResultEnvelope))

		const reviewResult = shell.router.relayCoderWorkResult(workResultEnvelope)
		artifactRefs["reviewResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-review-result.json", reviewResult))
		if (reviewResult.status !== "delivered" || reviewResult.responseEnvelope?.messageType !== "review_pass") {
			return finalize({
				status: "failed",
				stopReason: "queenbee_review_failed",
				detail: `QueenBee review did not return a bounded review_pass verdict for the ${spec.rowLabel}.`,
				verificationStatus: "failed",
			})
		}
		shell.router.routeEnvelope(reviewResult.responseEnvelope)

		const verificationResult = shell.router.relayReviewVerdictToVerifier(
			reviewResult.responseEnvelope,
			[...proofCommands],
			spec.verificationRouteLabel,
		)
		artifactRefs["verificationResult"] = relativeToWorkspace(
			context.workspace,
			writeJsonArtifact(runDir, "queenbee-verification-result.json", verificationResult),
		)
		const verificationPayload = asRecord(verificationResult.responseEnvelope?.payload)
		verificationResults = Array.isArray(verificationPayload?.["results"])
			? verificationPayload["results"].flatMap((row) => {
					const record = asRecord(row)
					const command = typeof record?.["command"] === "string" ? record["command"] : ""
					const exitCode = typeof record?.["exitCode"] === "number" ? record["exitCode"] : 1
					const passed = record?.["passed"] === true
					const outputSummary = typeof record?.["outputSummary"] === "string" ? record["outputSummary"] : "verification result missing"
					return command
						? [
								{
									command,
									exitCode,
									passed,
									outputSummary,
								} satisfies QueenBeeVerificationResultRow,
						  ]
						: []
			  })
			: []
		if (verificationResult.status !== "delivered" || verificationResult.responseEnvelope?.messageType !== "verification_pass") {
			return finalize({
				status: "failed",
				stopReason: "verification_failed",
				detail: `QueenBee verification did not clear the bounded repo-side proof command for the ${spec.rowLabel}.`,
				verificationStatus: "failed",
			})
		}
		shell.router.routeEnvelope(verificationResult.responseEnvelope)

		const mergeResult = shell.router.relayVerificationVerdictToMerge(verificationResult.responseEnvelope, workResultEnvelope)
		artifactRefs["mergeResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-merge-result.json", mergeResult))
		if (mergeResult.status !== "delivered" || mergeResult.responseEnvelope?.messageType !== "merge_pass") {
			return finalize({
				status: "failed",
				stopReason: "merge_conflict",
				detail: `QueenBee merge did not produce a bounded merge_pass verdict for the ${spec.rowLabel}.`,
				verificationStatus: "failed",
			})
		}
		shell.router.routeEnvelope(mergeResult.responseEnvelope)

		const commitArtifact = commitMergedChanges(context.workspace, context.task)
		artifactRefs["commitResult"] = relativeToWorkspace(
			context.workspace,
			writeJsonArtifact(runDir, "queenbee-commit-result.json", commitArtifact),
		)
		if (!commitArtifact.committed) {
			return finalize({
				status: "failed",
				stopReason: "queenbee_live_commit_failed",
				detail: `QueenBee merged the ${spec.rowLabel} but could not leave the workspace clean after the merge commit attempt.`,
				verificationStatus: "passed",
			})
		}

		const archiveResult = shell.router.relayMergeResultToArchivist(mergeResult.responseEnvelope)
		artifactRefs["archiveResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-archive-result.json", archiveResult))
		if (archiveResult.status !== "delivered" || archiveResult.responseEnvelope?.messageType !== "archive_written") {
			return finalize({
				status: "failed",
				stopReason: "queenbee_archive_failed",
				detail: `QueenBee archive did not write the bounded completion artifact for the ${spec.rowLabel}.`,
				verificationStatus: "passed",
			})
		}
		shell.router.routeEnvelope(archiveResult.responseEnvelope)
		archivePath = typeof asRecord(archiveResult.responseEnvelope.payload)?.["archivePath"] === "string"
			? String(asRecord(archiveResult.responseEnvelope.payload)?.["archivePath"])
			: null

		artifactRefs["protocolLedger"] = relativeToWorkspace(
			context.workspace,
			writeJsonArtifact(runDir, "queenbee-protocol-ledger.json", shell.protocolLedger.buildArtifact()),
		)
		if (archivePath) {
			artifactRefs["archivePath"] = archivePath
		}

		return finalize({
			status: "done",
			stopReason: "success",
			detail: `Provider-backed coding, review, repo-side verification, merge, and archive all completed for the bounded ${spec.rowLabel}.`,
			verificationStatus: "passed",
		})
	} catch (error) {
		const rawProviderResponse =
			error && typeof error === "object" && typeof (error as { rawResponse?: unknown }).rawResponse === "string"
				? String((error as { rawResponse: string }).rawResponse)
				: null
		if (rawProviderResponse) {
			providerCallObserved = true
			artifactRefs["providerRawResponse"] = relativeToWorkspace(
				context.workspace,
				writeTextArtifact(runDir, "queenbee-provider-raw-response.txt", rawProviderResponse),
			)
		}
		artifactRefs["protocolLedger"] = relativeToWorkspace(
			context.workspace,
			writeJsonArtifact(runDir, "queenbee-protocol-ledger.json", shell.protocolLedger.buildArtifact()),
		)
		return finalize({
			status: "failed",
			stopReason: inferProviderStopReason(error),
			detail: error instanceof Error ? error.message : String(error),
			verificationStatus: verificationResults.every((result) => result.passed) && verificationResults.length > 0 ? "passed" : "failed",
		})
	} finally {
		if (reservedBeeId) {
			const releaseResult = shell.router.routeEnvelope(
				buildQueenBeeEnvelope({
					messageId: `${missionId}:bee_release`,
					missionId,
					assignmentId,
					senderBeeId: "queenbee.router.001",
					recipientBeeId: "queenbee.registry.001",
					messageType: "bee_release",
					timestamp: new Date().toISOString(),
					payload: {
						targetBeeId: reservedBeeId,
						assignmentId,
					},
				}),
			)
			artifactRefs["releaseResult"] = relativeToWorkspace(context.workspace, writeJsonArtifact(runDir, "queenbee-release-result.json", releaseResult))
		}
		if (artifactRefs["protocolLedger"]) {
			writeJsonArtifact(runDir, "queenbee-protocol-ledger.json", shell.protocolLedger.buildArtifact())
		}
	}
}

export async function runQueenBeeRuntime(context: TaskEngineRunContext): Promise<TaskEngineRunResult> {
	const canonicalLiveSpec = resolveCanonicalLiveSpec(context)
	if (canonicalLiveSpec) {
		return await runBoundedLiveRow(context, canonicalLiveSpec)
	}
	const firstGatewayLiveSpec = resolveFirstGatewayLiveSpec(context)
	if (firstGatewayLiveSpec) {
		return await runBoundedLiveRow(context, firstGatewayLiveSpec)
	}
	return {
		engine: "queenbee",
		status: "candidate_not_ready",
		stopReason: "candidate_engine_not_ready",
		message: formatQueenBeeCandidateBoundaryMessage(context),
		summaryPath: null,
	}
}
