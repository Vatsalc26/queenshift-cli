import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"
import {
	formatQueenBeeLiveFirstCanonicalHarnessResult,
	runQueenBeeLiveFirstCanonicalHarness,
	type QueenBeeLiveFirstCanonicalHarnessResult,
} from "./verify_queenbee_live_first_canonical"

type CandidateProgressSnapshot = {
	engine?: string
	status?: string
	stopReason?: string
	taskFamilyHint?: string | null
	allowedFiles?: string[]
	activeQueue?: string
	currentStage?: string
	selectedSpecialist?: string | null
	confidenceOutcome?: string | null
	executionAttempted?: boolean
	missionId?: string | null
	assignmentId?: string | null
	lastEventAt?: string | null
	nextTimeoutAt?: string | null
	nextExpectedHandoff?: string | null
}

type PreviewHoldObservation = {
	id: string
	passed: boolean
	artifactPath: string
	repoCleanAfter: boolean
	taskFamilyHint: string | null
	selectedSpecialist: string | null
	details: string[]
}

type CanonicalLiveObservation = {
	id: string
	passed: boolean
	summaryPath: string | null
	archivePath: string | null
	repoCleanAfter: boolean
	taskFamily: string | null
	selectedSpecialist: string | null
	details: string[]
}

type PreviewHoldRowSpec = {
	id: string
	task: string
	expectedFamily: string
	expectedSpecialist: string
	expectedFiles: string[]
	setup?: (repoPath: string) => Promise<void>
}

type CanonicalLiveRowSpec = {
	id: string
	task: string
	expectedFamily: string
	expectedSpecialist: string
	expectedFiles: string[]
	expectedSnippets: Array<{ path: string; snippet: string }>
	setup?: (repoPath: string) => Promise<void>
}

export type QueenBeeLiveCanonicalHarnessResult = {
	packageScriptsPresent: boolean
	liveEvalMatrixAligned: boolean
	liveEvidencePackAligned: boolean
	canonicalPackPresent: boolean
	reproAligned: boolean
	sideBySideAligned: boolean
	comparativeBenchmarkAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	providerConfigured: boolean
	firstCanonicalHarnessPassed: boolean
	expandedLiveRowsObserved: boolean
	remainingHoldRowsObserved: boolean
	fileCreationHoldRecorded: boolean
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

function normalizeFilePath(value: string): string {
	return value.replace(/[\\/]+/g, "/").trim()
}

function hasSameFileSet(left: string[], right: string[]): boolean {
	const leftSet = new Set(left.map(normalizeFilePath).filter(Boolean))
	const rightSet = new Set(right.map(normalizeFilePath).filter(Boolean))
	if (leftSet.size !== rightSet.size) return false
	for (const value of leftSet) {
		if (!rightSet.has(value)) return false
	}
	return true
}

async function runCli(
	rootDir: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const tmpDir = path.join(rootDir, ".swarm", "tmp")
		fs.mkdirSync(tmpDir, { recursive: true })
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `queenbee-live-canonical-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-live-canonical-${stamp}.stderr.log`)
		const stdoutFd = fs.openSync(stdoutPath, "w")
		const stderrFd = fs.openSync(stderrPath, "w")
		const readFile = (filePath: string): string => {
			try {
				return fs.readFileSync(filePath, "utf8")
			} catch {
				return ""
			}
		}
		const cleanup = () => {
			try {
				fs.closeSync(stdoutFd)
			} catch {
				// ignore
			}
			try {
				fs.closeSync(stderrFd)
			} catch {
				// ignore
			}
			try {
				fs.unlinkSync(stdoutPath)
			} catch {
				// ignore
			}
			try {
				fs.unlinkSync(stderrPath)
			} catch {
				// ignore
			}
		}

		const child = spawn(process.execPath, ["dist/swarm.js", ...args], {
			cwd: rootDir,
			env,
			windowsHide: true,
			stdio: ["ignore", stdoutFd, stderrFd],
		})

		child.once("error", (err) => {
			cleanup()
			reject(err)
		})
		child.once("close", (code) => {
			const stdout = readFile(stdoutPath)
			const stderr = readFile(stderrPath)
			cleanup()
			resolve({ code, stdout, stderr })
		})
	})
}

async function commitFixtureChanges(repoPath: string, message: string): Promise<void> {
	const status = await runVerificationGit(repoPath, ["status", "--porcelain", "--untracked-files=all"])
	if (!status.trim()) return
	await runVerificationGit(repoPath, ["add", "-A"])
	await runVerificationGit(repoPath, ["commit", "-m", message])
}

async function setupFileAndTestFixture(repoPath: string): Promise<void> {
	const sourcePath = path.join(repoPath, "src", "format.ts")
	const testPath = path.join(repoPath, "src", "format.test.ts")
	fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
	fs.writeFileSync(sourcePath, `export function formatLine(input: string): string {\n\treturn input.trim()\n}\n`, "utf8")
	fs.writeFileSync(
		testPath,
		`import { formatLine } from "./format"\n\nexport function expectFormat(): string {\n\treturn formatLine(" hello ")\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification canonical file-and-test baseline")
}

async function setupRenameFixture(repoPath: string): Promise<void> {
	fs.writeFileSync(
		path.join(repoPath, "format.ts"),
		'export function formatLine(input: string): string {\n\treturn input.trim()\n}\n',
		"utf8",
	)
	fs.writeFileSync(
		path.join(repoPath, "hello.ts"),
		'import { formatLine } from "./format"\n\nexport function greet(name: string): string {\n\treturn formatLine(name)\n}\n',
		"utf8",
	)
	fs.writeFileSync(
		path.join(repoPath, "utils.ts"),
		'import { formatLine } from "./format"\n\nexport function shout(input: string): string {\n\treturn formatLine(input).toUpperCase()\n}\n',
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification canonical rename baseline")
}

function canonicalLiveRows(): CanonicalLiveRowSpec[] {
	return [
		{
			id: "QB-LIVE-02",
			task: 'update utils.ts so it includes the exact text "// queenbee: named utils"',
			expectedFamily: "update_named_file",
			expectedSpecialist: "JSTSCoreBee",
			expectedFiles: ["utils.ts"],
			expectedSnippets: [{ path: "utils.ts", snippet: "// queenbee: named utils" }],
		},
		{
			id: "QB-LIVE-04",
			task: 'update src/format.ts and src/format.test.ts so both files include the exact comment "// queenbee: file and test".',
			expectedFamily: "update_file_and_test",
			expectedSpecialist: "JSTSTestBee",
			expectedFiles: ["src/format.ts", "src/format.test.ts"],
			expectedSnippets: [
				{ path: "src/format.ts", snippet: "// queenbee: file and test" },
				{ path: "src/format.test.ts", snippet: "// queenbee: file and test" },
			],
			setup: setupFileAndTestFixture,
		},
		{
			id: "QB-LIVE-05",
			task: "rename the export in format.ts to formatValue and update its direct call sites in hello.ts and utils.ts",
			expectedFamily: "rename_export",
			expectedSpecialist: "JSTSCoreBee",
			expectedFiles: ["format.ts", "hello.ts", "utils.ts"],
			expectedSnippets: [
				{ path: "format.ts", snippet: "formatValue" },
				{ path: "hello.ts", snippet: "formatValue" },
				{ path: "utils.ts", snippet: "formatValue" },
			],
			setup: setupRenameFixture,
		},
		{
			id: "QB-LIVE-06",
			task: 'add the exact comment "// queenbee: node cli hello" to hello.ts and add a npm run cli entry in package.json',
			expectedFamily: "bounded_node_cli_task",
			expectedSpecialist: "JSTSNodeBee",
			expectedFiles: ["hello.ts", "package.json"],
			expectedSnippets: [
				{ path: "hello.ts", snippet: "// queenbee: node cli hello" },
				{ path: "package.json", snippet: "\"queenbee:node:hello\": \"node ./hello.ts\"" },
			],
		},
	]
}

function previewHoldRows(): PreviewHoldRowSpec[] {
	return [
		{
			id: "QB-LIVE-03",
			task: 'add the exact comment "// queenbee: two-file pass" to hello.ts and utils.ts',
			expectedFamily: "bounded_two_file_update",
			expectedSpecialist: "JSTSRefactorBee",
			expectedFiles: ["hello.ts", "utils.ts"],
		},
		{
			id: "QB-LIVE-07",
			task: 'create src/queenbeeTiny.ts with the exact comment "// queenbee: file creation candidate"',
			expectedFamily: "create_tiny_file",
			expectedSpecialist: "JSTSCoreBee",
			expectedFiles: ["src/queenbeeTiny.ts"],
			setup: async (repoPath: string) => {
				fs.mkdirSync(path.join(repoPath, "src"), { recursive: true })
			},
		},
	]
}

async function observeLiveRow(
	rootDir: string,
	row: CanonicalLiveRowSpec,
	env: NodeJS.ProcessEnv,
): Promise<CanonicalLiveObservation> {
	const details: string[] = []
	const fixture = await createTempTestRepoCopy(rootDir, `queenbee-live-canonical-${row.id.toLowerCase()}`)
	try {
		if (row.setup) {
			await row.setup(fixture.repoPath)
		}

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", row.task, "--workspace", fixture.repoPath], env)
		const summaryDir = path.join(fixture.repoPath, ".swarm", "runs")
		const summaryPath = fs.existsSync(summaryDir)
			? fs
					.readdirSync(summaryDir)
					.map((entry) => path.join(summaryDir, entry, "summary.json"))
					.filter((candidate) => fs.existsSync(candidate))
					.sort()
					.pop() ?? null
			: null
		const summary = summaryPath ? (JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>) : null
		const queenbeeLive = summary && typeof summary["queenbeeLive"] === "object" ? (summary["queenbeeLive"] as Record<string, unknown>) : null
		const provider = summary && typeof summary["provider"] === "object" ? (summary["provider"] as Record<string, unknown>) : null
		const verificationProfile =
			summary && typeof summary["verificationProfile"] === "object" ? (summary["verificationProfile"] as Record<string, unknown>) : null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0
		const archivePath = queenbeeLive && typeof queenbeeLive["archivePath"] === "string" ? String(queenbeeLive["archivePath"]) : null
		const archiveAbsolutePath = archivePath ? path.join(fixture.repoPath, archivePath) : null
		const changedFiles = Array.isArray(queenbeeLive?.["changedFiles"]) ? (queenbeeLive?.["changedFiles"] as string[]) : []
		const filesAligned = row.expectedSnippets.every(({ path: relativePath, snippet }) => {
			const absolutePath = path.join(fixture.repoPath, relativePath)
			return fs.existsSync(absolutePath) && fs.readFileSync(absolutePath, "utf8").includes(snippet)
		})

		const cliAligned =
			cliResult.code === 0 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: done") &&
			cliResult.stdout.includes(`[Swarm] Live row: ${row.id} (${row.expectedFamily}) over`) &&
			cliResult.stdout.includes(`[Swarm] Selected specialist: ${row.expectedSpecialist}.`) &&
			cliResult.stdout.includes("[Swarm] Provider call observed: yes.") &&
			cliResult.stdout.includes("[Swarm] Proof commands: npm.cmd test.")

		const summaryAligned =
			Boolean(summaryPath) &&
			summary?.["engine"] === "queenbee" &&
			summary?.["status"] === "done" &&
			summary?.["stopReason"] === "success" &&
			provider?.["providerCallObserved"] === true &&
			verificationProfile?.["status"] === "passed" &&
			queenbeeLive?.["rowId"] === row.id &&
			queenbeeLive?.["taskFamily"] === row.expectedFamily &&
			queenbeeLive?.["selectedSpecialist"] === row.expectedSpecialist &&
			hasSameFileSet(changedFiles, row.expectedFiles) &&
			Array.isArray(queenbeeLive?.["proofCommands"]) &&
			(queenbeeLive?.["proofCommands"] as string[]).join(",") === "npm.cmd test"

		const shellSnapshotAligned =
			Boolean(summaryPath) &&
			shellSnapshot.summaryPath === summaryPath &&
			shellSnapshot.summaryText.includes(`"rowId": "${row.id}"`) &&
			shellSnapshot.summaryText.includes(`"taskFamily": "${row.expectedFamily}"`) &&
			shellSnapshot.summaryText.includes(`"selectedSpecialist": "${row.expectedSpecialist}"`) &&
			shellSnapshot.summaryText.includes('"providerCallObserved": true') &&
			shellSnapshot.forensicsText.includes("Terminal status: done") &&
			shellSnapshot.forensicsText.includes("Likely failure bucket: success")

		const passed =
			cliAligned &&
			summaryAligned &&
			shellSnapshotAligned &&
			repoCleanAfter &&
			Boolean(archivePath) &&
			Boolean(archiveAbsolutePath && fs.existsSync(archiveAbsolutePath)) &&
			filesAligned

		details.push(
			`cliCode=${String(cliResult.code)}`,
			`summary=${summaryPath ?? "missing"}`,
			`archive=${archivePath ?? "missing"}`,
			`stdout=${cliResult.stdout.replace(/\r?\n/g, " | ")}`,
		)

		return {
			id: row.id,
			passed,
			summaryPath,
			archivePath,
			repoCleanAfter,
			taskFamily: typeof queenbeeLive?.["taskFamily"] === "string" ? String(queenbeeLive["taskFamily"]) : null,
			selectedSpecialist: typeof queenbeeLive?.["selectedSpecialist"] === "string" ? String(queenbeeLive["selectedSpecialist"]) : null,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

async function observePreviewHoldRow(
	rootDir: string,
	row: PreviewHoldRowSpec,
	env: NodeJS.ProcessEnv,
): Promise<PreviewHoldObservation> {
	const details: string[] = []
	const fixture = await createTempTestRepoCopy(rootDir, `queenbee-live-canonical-${row.id.toLowerCase()}`)
	try {
		if (row.setup) {
			await row.setup(fixture.repoPath)
		}

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", row.task, "--workspace", fixture.repoPath], env)
		const artifactPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")
		const artifactExists = fs.existsSync(artifactPath)
		const artifact = artifactExists
			? (JSON.parse(fs.readFileSync(artifactPath, "utf8")) as CandidateProgressSnapshot)
			: null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0

		const cliAligned =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes(`Current bounded candidate hint: ${row.expectedFamily}`) &&
			cliResult.stdout.includes(`Selected specialist: ${row.expectedSpecialist}.`) &&
			cliResult.stdout.includes("Confidence outcome: candidate_preview_only.") &&
			cliResult.stdout.includes(`Progress artifact: ${artifactPath}.`) &&
			cliResult.stdout.includes("No live coding, review, verification, or merge was executed on this candidate path.") &&
			cliResult.stderr.includes("[Swarm] Engine not ready.")

		const artifactAligned =
			Boolean(artifact) &&
			artifact?.engine === "queenbee" &&
			artifact?.status === "candidate_not_ready" &&
			artifact?.stopReason === "candidate_engine_not_ready" &&
			artifact?.taskFamilyHint === row.expectedFamily &&
			artifact?.selectedSpecialist === row.expectedSpecialist &&
			hasSameFileSet(artifact?.allowedFiles ?? [], row.expectedFiles) &&
			artifact?.activeQueue === "specialist_queue" &&
			artifact?.currentStage === "proposal" &&
			artifact?.confidenceOutcome === "candidate_preview_only" &&
			artifact?.executionAttempted === false &&
			typeof artifact?.missionId === "string" &&
			artifact.missionId.startsWith("qb-preview-mission-") &&
			artifact?.assignmentId === `qb-preview-${row.expectedFamily}` &&
			typeof artifact?.lastEventAt === "string" &&
			artifact.lastEventAt.length > 0 &&
			typeof artifact?.nextTimeoutAt === "string" &&
			artifact.nextTimeoutAt.length > 0 &&
			typeof artifact?.nextExpectedHandoff === "string" &&
			artifact.nextExpectedHandoff.includes(row.expectedSpecialist)

		const shellSnapshotAligned =
			shellSnapshot.summaryPath === null &&
			shellSnapshot.summaryText.includes(`Artifact: ${artifactPath}`) &&
			shellSnapshot.summaryText.includes(`"taskFamilyHint": "${row.expectedFamily}"`) &&
			shellSnapshot.summaryText.includes(`"selectedSpecialist": "${row.expectedSpecialist}"`) &&
			shellSnapshot.summaryText.includes('"confidenceOutcome": "candidate_preview_only"') &&
			shellSnapshot.forensicsText.includes("QueenBee candidate progress preview") &&
			shellSnapshot.forensicsText.includes("Stage: proposal (specialist_queue)") &&
			shellSnapshot.forensicsText.includes(`Selected specialist: ${row.expectedSpecialist}`) &&
			shellSnapshot.forensicsText.includes("Confidence outcome: candidate_preview_only") &&
			shellSnapshot.forensicsText.includes("Stop reason: candidate_engine_not_ready")

		const passed = cliAligned && artifactAligned && shellSnapshotAligned && repoCleanAfter
		details.push(
			`stdout=${cliResult.stdout.replace(/\r?\n/g, " | ")}`,
			`artifact=${artifactExists ? artifactPath : "(missing)"}`,
			`taskFamilyHint=${artifact?.taskFamilyHint ?? "missing"}`,
			`selectedSpecialist=${artifact?.selectedSpecialist ?? "missing"}`,
		)

		return {
			id: row.id,
			passed,
			artifactPath,
			repoCleanAfter,
			taskFamilyHint: artifact?.taskFamilyHint ?? null,
			selectedSpecialist: artifact?.selectedSpecialist ?? null,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export async function runQueenBeeLiveCanonicalHarness(rootDir = resolveRootDir()): Promise<QueenBeeLiveCanonicalHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const matrixText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const liveEvidencePackText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const canonicalPackText = readText(rootDir, "QUEENBEE_LIVE_CANONICAL_PACK.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const comparativeBenchmarkText = readText(rootDir, "COMPARATIVE_BENCHMARK_REPORT.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const providerSelection = resolveOwnerProviderSelection(process.env)
	const expectedProvider = providerSelection.provider ?? "(missing)"
	const expectedModel = providerSelection.model ?? "(missing)"

	const packageScriptsPresent =
		packageJson.scripts?.["verify:queenbee:live:first-canonical"] ===
			"npm run build && node dist/verification/verify_queenbee_live_first_canonical.js" &&
		packageJson.scripts?.["verify:queenbee:live:canonical"] ===
			"npm run build && node dist/verification/verify_queenbee_live_canonical.js"

	const liveEvalMatrixAligned = includesAll(matrixText, [
		"`QB-LIVE-01`",
		"Session 239 first live canonical row for `comment_file`, refreshed in Session 268 with one async-sensitive provider-backed observation",
		"`QB-LIVE-02`",
		"`QB-LIVE-04`",
		"`QB-LIVE-05`",
		"`QB-LIVE-06`",
		"`QB-LIVE-07`",
		"`live_pass`",
		"`mixed_hold`",
		`| \`QB-LIVE-01\` | \`QB-CAN-01\` | \`${expectedProvider}\` | \`${expectedModel}\` |`,
		"## Session 270 Canonical Live Expansion Reading",
		"`JSTSAsyncBee`",
		"`JSTSTestBee`",
		"`JSTSNodeBee`",
	])

	const liveEvidencePackAligned = includesAll(liveEvidencePackText, [
		"## Session 239 First Canonical Live Pass",
		"`QB-LIVE-01` now records `live_pass` with provider-backed coding, review, repo-side verification, merge, and archive",
		"`verify:queenbee:live:first-canonical`",
		"`verify:queenbee:live:canonical`",
		"## Session 268 Async Canonical Live Refresh",
		"`JSTSAsyncBee`",
		"## Session 270 Canonical Live Expansion",
		"`QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06` now record `live_pass`",
		"`QB-LIVE-03` and `QB-LIVE-07` remain `mixed_hold` with `candidate_preview_only`",
	])

	const canonicalPackPresent = includesAll(canonicalPackText, [
		"`QB-LIVE-01`",
		"`currentStatus`: `live_pass`",
		"`QB-LIVE-02`",
		"`QB-LIVE-04`",
		"`QB-LIVE-05`",
		"`QB-LIVE-06`",
		"`QB-LIVE-07`",
		"`candidate_preview_only`",
		"`bounded_live_pass`",
		"`providerCallObserved`",
		"`npm.cmd test`",
		"`JSTSAsyncBee`",
		"`JSTSTestBee`",
		"`JSTSNodeBee`",
		"`src/retry.ts`",
	])

	const reproAligned = includesAll(reproText, [
		"## Session 239 First Canonical Live Reading",
		"`QB-LIVE-01`",
		"`providerCallObserved=true`",
		"## Session 268 Async Canonical Live Reading",
		"`selectedSpecialist=JSTSAsyncBee`",
		"## Session 270 Canonical Live Expansion Reading",
		"`QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06` now join `QB-LIVE-01` as provider-backed canonical live rows",
		"`QB-LIVE-03` and `QB-LIVE-07` remain `candidate_preview_only`",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"## Session 239 First Canonical Live Reading",
		"`QB-LIVE-01`",
		"`live_pass`",
		"## Session 268 Async Canonical Live Reading",
		"`QB-EX-01`",
		"## Session 270 Canonical Live Expansion Reading",
		"`QB-EX-02`, `QB-EX-04`, `QB-EX-05`, and `QB-EX-06`",
		"`QB-EX-03` and `QB-EX-07` remain hold evidence",
	])

	const comparativeBenchmarkAligned = includesAll(comparativeBenchmarkText, [
		"## Session 239 First Canonical Live Pass",
		"`QB-LIVE-01`",
		"`live_pass`",
		"## Session 270 Canonical Live Expansion Reading",
		"`QB-LIVE-01`, `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, `QB-LIVE-06`, and `QB-LIVE-GW-01` now provide six real provider-backed QueenBee live anchors",
		"`QB-LIVE-03`, `QB-LIVE-07`, the natural-language rows, and gateway rows `QB-GW-02` through `QB-GW-04` still remain `mixed_hold` or proof-backed-only surfaces",
		"no cross-tool victory claim, replacement claim, or public benchmark widening follows from this pack",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 268 refreshes the first canonical live row around one async-specialist observation without widening the live gate",
		"**Session:** 268",
		"`QB-LIVE-01`",
		"`verify:queenbee:live:first-canonical`",
		"`verify:queenbee:live:canonical`",
		"## Decision: Session 270 widens the canonical live pack across core, test, rename, and Node lanes while keeping refactor and create-safe rows on explicit hold",
		"**Session:** 270",
		"`QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B36 |",
		"Does QueenBee now have a provider-backed live canonical pack across the current bounded rows? | NO |",
		"| B45 |",
		"Does QueenBee now have one provider-backed live canonical row while the rest of the bounded canonical pack stays frozen? | NO |",
		"| B58 |",
		"Does QueenBee still retain an async-specialist live canonical observation on `QB-LIVE-01` inside the wider canonical live pack? | YES |",
		"| B60 |",
		"Does QueenBee now have provider-backed canonical live coverage across core named-file, test, rename, and Node/CLI rows while refactor and create-safe rows stay explicit hold? | YES |",
		"`npm.cmd run verify:queenbee:live:first-canonical`",
		"`npm.cmd run verify:queenbee:live:canonical`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:live:first-canonical`",
		"`npm.cmd run verify:queenbee:live:canonical`",
		"the Session 239 canonical pack now records one provider-backed QueenBee live pass for `QB-LIVE-01`, keeps `QB-LIVE-02` through `QB-LIVE-07` on explicit preview hold, and refuses to widen that single proof into an all-row live claim",
		"the Session 268 first canonical live row now records one async-sensitive provider-backed observation through `JSTSAsyncBee`",
		"the Session 270 canonical live pack expansion now records provider-backed live passes for `QB-LIVE-02`, `QB-LIVE-04`, `QB-LIVE-05`, and `QB-LIVE-06`",
	])

	const providerConfigured =
		providerSelection.provider === "gemini" &&
		providerSelection.ready &&
		providerSelection.model === "gemini-2.5-flash"

	details.push(
		`provider=${providerSelection.provider ?? "none"}`,
		`model=${providerSelection.model ?? "none"}`,
		`transport=${providerSelection.transport}`,
		`providerReady=${providerSelection.ready ? "yes" : "no"}`,
	)

	const firstCanonicalHarness: QueenBeeLiveFirstCanonicalHarnessResult = await runQueenBeeLiveFirstCanonicalHarness(rootDir)
	const firstCanonicalHarnessPassed =
		firstCanonicalHarness.packageScriptPresent &&
		firstCanonicalHarness.liveDocsPresent &&
		firstCanonicalHarness.architectureDecisionRecorded &&
		firstCanonicalHarness.verificationCatalogAligned &&
		firstCanonicalHarness.capabilityChecklistAligned &&
		firstCanonicalHarness.providerConfigured &&
		firstCanonicalHarness.firstCanonicalRowObserved
	details.push(
		`firstCanonicalHarness=${firstCanonicalHarnessPassed ? "PASS" : "FAIL"}`,
		...formatQueenBeeLiveFirstCanonicalHarnessResult(firstCanonicalHarness)
			.split(/\r?\n/g)
			.map((line) => `firstCanonical:${line}`),
	)

	let expandedLiveRowsObserved = false
	let remainingHoldRowsObserved = false
	if (providerConfigured) {
		const env = { ...process.env, ...providerSelection.envOverrides }
		const liveRowObservations: CanonicalLiveObservation[] = []
		for (const row of canonicalLiveRows()) {
			liveRowObservations.push(await observeLiveRow(rootDir, row, env))
		}
		expandedLiveRowsObserved = liveRowObservations.every((row) => row.passed)
		for (const row of liveRowObservations) {
			details.push(
				`${row.id}=${row.passed ? "PASS" : "FAIL"} family=${row.taskFamily ?? "missing"} specialist=${row.selectedSpecialist ?? "missing"} clean=${row.repoCleanAfter ? "yes" : "no"} summary=${row.summaryPath ?? "missing"} archive=${row.archivePath ?? "missing"}`,
				...row.details.map((detail) => `${row.id}:${detail}`),
			)
		}

		const holdRowObservations: PreviewHoldObservation[] = []
		for (const row of previewHoldRows()) {
			holdRowObservations.push(await observePreviewHoldRow(rootDir, row, env))
		}
		remainingHoldRowsObserved = holdRowObservations.every((row) => row.passed)
		for (const row of holdRowObservations) {
			details.push(
				`${row.id}=${row.passed ? "PASS" : "FAIL"} family=${row.taskFamilyHint ?? "missing"} specialist=${row.selectedSpecialist ?? "missing"} clean=${row.repoCleanAfter ? "yes" : "no"} artifact=${row.artifactPath}`,
				...row.details.map((detail) => `${row.id}:${detail}`),
			)
		}
	} else {
		details.push(`providerReason=${providerSelection.reason}`)
	}

	const fileCreationHoldRecorded =
		includesAll(matrixText, [
			"`QB-LIVE-07`",
			"`mixed_hold`",
			"provider-configured CLI still stops at the candidate preview before provider-backed coding, review, verification, or merge",
		]) &&
		includesAll(canonicalPackText, [
			"`QB-LIVE-07`",
			"`create_tiny_file`",
			"`candidate_preview_only`",
			"`mixed_hold`",
		])

	return {
		packageScriptsPresent,
		liveEvalMatrixAligned,
		liveEvidencePackAligned,
		canonicalPackPresent,
		reproAligned,
		sideBySideAligned,
		comparativeBenchmarkAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		providerConfigured,
		firstCanonicalHarnessPassed,
		expandedLiveRowsObserved,
		remainingHoldRowsObserved,
		fileCreationHoldRecorded,
		details,
	}
}

export function formatQueenBeeLiveCanonicalHarnessResult(result: QueenBeeLiveCanonicalHarnessResult): string {
	return [
		`Package scripts present: ${result.packageScriptsPresent ? "PASS" : "FAIL"}`,
		`Live eval matrix aligned: ${result.liveEvalMatrixAligned ? "PASS" : "FAIL"}`,
		`Live evidence pack aligned: ${result.liveEvidencePackAligned ? "PASS" : "FAIL"}`,
		`Canonical pack present: ${result.canonicalPackPresent ? "PASS" : "FAIL"}`,
		`Repro aligned: ${result.reproAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Comparative benchmark aligned: ${result.comparativeBenchmarkAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Provider configured: ${result.providerConfigured ? "PASS" : "FAIL"}`,
		`First canonical harness passed: ${result.firstCanonicalHarnessPassed ? "PASS" : "FAIL"}`,
		`Expanded live rows observed: ${result.expandedLiveRowsObserved ? "PASS" : "FAIL"}`,
		`Remaining hold rows observed: ${result.remainingHoldRowsObserved ? "PASS" : "FAIL"}`,
		`File-creation hold recorded: ${result.fileCreationHoldRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLiveCanonicalHarness()
	console.log(formatQueenBeeLiveCanonicalHarnessResult(result))
	process.exit(
		result.packageScriptsPresent &&
			result.liveEvalMatrixAligned &&
			result.liveEvidencePackAligned &&
			result.canonicalPackPresent &&
			result.reproAligned &&
			result.sideBySideAligned &&
			result.comparativeBenchmarkAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.providerConfigured &&
			result.firstCanonicalHarnessPassed &&
			result.expandedLiveRowsObserved &&
			result.remainingHoldRowsObserved &&
			result.fileCreationHoldRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live:canonical] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
