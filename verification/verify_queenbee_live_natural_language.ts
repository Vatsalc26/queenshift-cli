import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { compileQueenBeeScoutScope, type QueenBeeScopeDerivationMode } from "../src/queenbee/QueenBeeNaturalLanguageScope"
import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"

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

type NaturalLanguageRowSpec = {
	id: string
	canonicalRowId: string
	task: string
	expectedFamily: string
	expectedSpecialist: string
	expectedFiles: string[]
	expectedCompileMode: QueenBeeScopeDerivationMode
	setup?: (repoPath: string) => Promise<void>
}

type QueenBeeLiveNaturalLanguageRowObservation = {
	id: string
	task: string
	passed: boolean
	exitCode: number | null
	artifactPath: string
	repoCleanAfter: boolean
	taskFamilyHint: string | null
	selectedSpecialist: string | null
	compileMode: QueenBeeScopeDerivationMode | null
	details: string[]
}

export type QueenBeeLiveNaturalLanguageHarnessResult = {
	packageScriptPresent: boolean
	liveEvalMatrixAligned: boolean
	liveEvidencePackAligned: boolean
	naturalLanguagePackPresent: boolean
	naturalLanguageContractAligned: boolean
	reproAligned: boolean
	sideBySideAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	providerConfigured: boolean
	supportedRowsObserved: boolean
	refusalBaselinesDocumented: boolean
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
		const stdoutPath = path.join(tmpDir, `queenbee-live-nl-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-live-nl-${stamp}.stderr.log`)
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
	await commitFixtureChanges(repoPath, "verification natural-language file-and-test baseline")
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
	await commitFixtureChanges(repoPath, "verification natural-language rename baseline")
}

async function setupUiLogicFixture(repoPath: string): Promise<void> {
	const componentPath = path.join(repoPath, "src", "ui", "Panel.tsx")
	const logicPath = path.join(repoPath, "src", "ui", "panelLogic.ts")
	fs.mkdirSync(path.dirname(componentPath), { recursive: true })
	fs.writeFileSync(
		componentPath,
		`import { buildPanelLabel } from "./panelLogic"\n\nexport function Panel(): string {\n\treturn buildPanelLabel("queenbee")\n}\n`,
		"utf8",
	)
	fs.writeFileSync(
		logicPath,
		`export function buildPanelLabel(input: string): string {\n\treturn input.toUpperCase()\n}\n`,
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification natural-language ui-logic baseline")
}

function supportedNaturalLanguageRows(): NaturalLanguageRowSpec[] {
	return [
		{
			id: "QB-LIVE-NL-01",
			canonicalRowId: "QB-CAN-01",
			task: 'please add a comment to hello.ts that says "// queenbee: live nl hello".',
			expectedFamily: "comment_file",
			expectedSpecialist: "JSTSCoreBee",
			expectedFiles: ["hello.ts"],
			expectedCompileMode: "explicit",
		},
		{
			id: "QB-LIVE-NL-02",
			canonicalRowId: "QB-CAN-06",
			task: 'update hello.ts and utils.ts together so both files include the exact comment "// queenbee: live nl pair".',
			expectedFamily: "bounded_two_file_update",
			expectedSpecialist: "JSTSRefactorBee",
			expectedFiles: ["hello.ts", "utils.ts"],
			expectedCompileMode: "explicit",
		},
		{
			id: "QB-LIVE-NL-03",
			canonicalRowId: "QB-CAN-05",
			task: 'update src/format.ts and keep its direct local test aligned so both files include the exact comment "// queenbee: live nl helper".',
			expectedFamily: "update_file_and_test",
			expectedSpecialist: "JSTSTestBee",
			expectedFiles: ["src/format.ts", "src/format.test.ts"],
			expectedCompileMode: "semi_open",
			setup: setupFileAndTestFixture,
		},
		{
			id: "QB-LIVE-NL-04",
			canonicalRowId: "QB-CAN-04",
			task: "rename formatLine in format.ts to formatValue and update its direct imports",
			expectedFamily: "rename_export",
			expectedSpecialist: "JSTSCoreBee",
			expectedFiles: ["format.ts", "hello.ts", "utils.ts"],
			expectedCompileMode: "semi_open",
			setup: setupRenameFixture,
		},
		{
			id: "QB-LIVE-NL-05",
			canonicalRowId: "QB-CAN-06",
			task: 'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: live nl ui".',
			expectedFamily: "bounded_two_file_update",
			expectedSpecialist: "JSTSRefactorBee",
			expectedFiles: ["src/ui/Panel.tsx", "src/ui/panelLogic.ts"],
			expectedCompileMode: "semi_open",
			setup: setupUiLogicFixture,
		},
	]
}

async function observeSupportedRow(
	rootDir: string,
	row: NaturalLanguageRowSpec,
	env: NodeJS.ProcessEnv,
): Promise<QueenBeeLiveNaturalLanguageRowObservation> {
	const details: string[] = []
	const fixture = await createTempTestRepoCopy(rootDir, `queenbee-live-nl-${row.id.toLowerCase()}`)
	try {
		if (row.setup) {
			await row.setup(fixture.repoPath)
		}

		const compiledScope = compileQueenBeeScoutScope({
			task: row.task,
			workspace: fixture.repoPath,
		})
		const compileAligned =
			compiledScope.accepted &&
			compiledScope.taskFamily === row.expectedFamily &&
			compiledScope.derivationMode === row.expectedCompileMode &&
			hasSameFileSet(compiledScope.targetFiles, row.expectedFiles)

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", row.task, "--workspace", fixture.repoPath], env)
		const artifactPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")
		const artifactExists = fs.existsSync(artifactPath)
		const artifact = artifactExists
			? (JSON.parse(fs.readFileSync(artifactPath, "utf8")) as CandidateProgressSnapshot)
			: null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0
		const hintSuffix = row.expectedFiles.join(", ")

		const cliAligned =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes(`Current bounded candidate hint: ${row.expectedFamily} over ${hintSuffix}.`) &&
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

		const passed = compileAligned && cliAligned && artifactAligned && shellSnapshotAligned && repoCleanAfter

		details.push(
			`compileAccepted=${compiledScope.accepted ? "yes" : "no"}`,
			`compileMode=${compiledScope.derivationMode ?? "missing"}`,
			`compileFamily=${compiledScope.taskFamily ?? "missing"}`,
			`compileTargets=${compiledScope.targetFiles.join(",") || "missing"}`,
			`exitCode=${String(cliResult.code)}`,
			`artifact=${artifactExists ? artifactPath : "(missing)"}`,
			`taskFamilyHint=${artifact?.taskFamilyHint ?? "missing"}`,
			`selectedSpecialist=${artifact?.selectedSpecialist ?? "missing"}`,
		)

		return {
			id: row.id,
			task: row.task,
			passed,
			exitCode: cliResult.code,
			artifactPath,
			repoCleanAfter,
			taskFamilyHint: artifact?.taskFamilyHint ?? null,
			selectedSpecialist: artifact?.selectedSpecialist ?? null,
			compileMode: compiledScope.derivationMode,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export async function runQueenBeeLiveNaturalLanguageHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeLiveNaturalLanguageHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const matrixText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const liveEvidencePackText = readText(rootDir, "QUEENBEE_LIVE_EVIDENCE_PACK.md")
	const naturalLanguagePackText = readText(rootDir, "QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md")
	const naturalLanguageContractText = readText(rootDir, "QUEENBEE_NATURAL_LANGUAGE_SCOPE_CONTRACT.md")
	const reproText = readText(rootDir, "QUEENBEE_MODEL_VARIANCE_AND_REPRODUCIBILITY.md")
	const sideBySideText = readText(rootDir, "QUEENBEE_SIDE_BY_SIDE_EXAMPLES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const providerSelection = resolveOwnerProviderSelection(process.env)
	const expectedProvider = providerSelection.provider ?? "(missing)"
	const expectedModel = providerSelection.model ?? "(missing)"

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:live:natural-language"] ===
		"npm run build && node dist/verification/verify_queenbee_live_natural_language.js"

	const liveEvalMatrixAligned = includesAll(matrixText, [
		"`QB-LIVE-NL-01`",
		"`QB-LIVE-NL-05`",
		`| \`QB-LIVE-NL-01\` | \`QB-CAN-01\` | \`${expectedProvider}\` | \`${expectedModel}\` |`,
		"`QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md#qb-live-nl-05`",
		"`mixed_hold`",
		"natural-language hold pack",
		"## Session 267 Natural-Language Intake Hardening",
		"update its direct imports",
		"## Session 273 Repo-Local UI Anchor Reading",
		"keep its direct ui logic aligned",
		"## Session 275 Expert Helper-Test Reading",
		"`QB-LIVE-NL-03`",
		"keep its direct local test aligned",
	])

	const liveEvidencePackAligned = includesAll(liveEvidencePackText, [
		"## Session 234 Natural-Language Hold Pack",
		"`QB-LIVE-NL-01` through `QB-LIVE-NL-04` now record `mixed_hold` with `candidate_preview_only`",
		"still-refused anchorless helper/test and unsupported docs-sync asks are carried in that pack as refusal baselines backed by `verify:queenbee:nl-scope`",
		"`verify:queenbee:live:natural-language`",
		"## Session 267 Natural-Language Intake Hardening",
		"`QB-LIVE-NL-04`",
		"direct-import alias",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`QB-LIVE-NL-05`",
		"one named existing UI anchor plus exactly one direct same-directory JS/TS companion",
		"## Session 275 Expert Helper-Test Reading",
		"`QB-LIVE-NL-03`",
		"one direct local test file",
	])

	const naturalLanguagePackPresent = includesAll(naturalLanguagePackText, [
		"# QueenBee Live Natural-Language Pack",
		"`liveEvalId`: `QB-LIVE-NL-2026-04-01`",
		`\`providerName\`: \`${expectedProvider}\``,
		`\`modelName\`: \`${expectedModel}\``,
		"`currentStatus`: `mixed_hold`",
		"`QB-LIVE-NL-01`",
		"`QB-LIVE-NL-05`",
		"`scopeCompileMode`",
		"`QB-NL-REF-01`",
		"`natural_language_scope_missing_anchor_file`",
		"`QB-NL-REF-02`",
		"`natural_language_scope_unsupported_lane`",
		'update src/format.ts and keep its direct local test aligned so both files include the exact comment "// queenbee: live nl helper".',
		"rename formatLine in format.ts to formatValue and update its direct imports",
		'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: live nl ui".',
		"## Session 267 Intake Hardening Reading",
		"## Session 273 Repo-Local UI Anchor Reading",
		"## Session 275 Expert Helper-Test Reading",
	])

	const naturalLanguageContractAligned = includesAll(naturalLanguageContractText, [
		"## Session 234 Live Hold Reading",
		"`QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md`",
		"`QB-LIVE-NL-01` through `QB-LIVE-NL-04`",
		"`candidate_preview_only`",
		"`verify:queenbee:live:natural-language`",
		"## Session 267 Intake Hardening Reading",
		"update its direct imports",
		"## Session 273 Repo-Local UI Anchor Reading",
		"existing-file UI logic rows may now start from one named existing UI anchor file",
		"`QB-LIVE-NL-05`",
		"## Session 275 Expert Helper-Test Reading",
		"keep its direct local test aligned",
		"`QB-LIVE-NL-03`",
	])

	const reproAligned = includesAll(reproText, [
		"## Session 234 Natural-Language Hold Reading",
		"`QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md`",
		"`candidate_preview_only`",
		"`providerCallObserved=false`",
		"## Session 267 Natural-Language Intake Hardening",
		"direct-import alias",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`QB-LIVE-NL-05`",
		"same explicit target-file set",
		"## Session 275 Expert Helper-Test Reading",
		"`QB-LIVE-NL-03`",
		"same explicit source-plus-test target-file set",
	])

	const sideBySideAligned = includesAll(sideBySideText, [
		"## Session 234 Natural-Language Hold Reading",
		"`QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md`",
		"`QB-LIVE-NL-01` through `QB-LIVE-NL-04`",
		"`mixed_hold`",
		"## Session 267 Natural-Language Intake Hardening",
		"update its direct imports",
		"## Session 273 Repo-Local UI Anchor Reading",
		"`QB-LIVE-NL-05`",
		"one named existing UI anchor",
		"## Session 275 Expert Helper-Test Reading",
		"`QB-LIVE-NL-03`",
		"one named source helper",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 267 accepts one calmer direct-import rename phrasing without widening QueenBee scope",
		"**Session:** 267",
		"`rename_export` family",
		"`mixed_hold` with `candidate_preview_only`",
		"## Decision: Session 273 widens bounded repo-local natural-language scope by one UI-anchor lane and one aggregate gateway proof",
		"**Session:** 273",
		"`QB-LIVE-NL-05`",
		"## Decision: Session 275 carries one calmer anchor-first helper/test phrasing across the bounded natural-language hold and UX surfaces",
		"**Session:** 275",
		"`QB-LIVE-NL-03`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B57 |",
		"`QUEENBEE_LIVE_NATURAL_LANGUAGE_PACK.md`",
		"`npm.cmd run verify:queenbee:live:natural-language`",
		"`candidate_preview_only`",
		"`update its direct imports`",
		"| B63 |",
		"keep its direct ui logic aligned",
		"`npm.cmd run verify:queenbee:gateway`",
		"| B65 |",
		"keep its direct local test aligned",
		"`npm.cmd run verify:queenbee:live:natural-language`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:live:natural-language`",
		"the Session 234 live natural-language hold pack now records supported-provider-configured preview-only readings",
		"`refusal baselines`",
		"the Session 267 natural-language intake hardening now accepts one calmer direct-import rename alias",
		"the Session 273 bounded repo-local scope widening now accepts one named UI anchor",
		"`npm.cmd run verify:queenbee:gateway`",
		"the Session 275 expert helper/test intake hardening now carries one calmer anchor-first helper/test phrasing",
	])

	const refusalBaselinesDocumented =
		includesAll(naturalLanguagePackText, [
			"## Still-Refused Baselines",
			"`QB-NL-REF-01`",
			"`QB-NL-REF-02`",
			"`verify:queenbee:nl-scope`",
		]) &&
		includesAll(naturalLanguageContractText, [
			"`verify:queenbee:nl-scope`",
			"anchorless helper/test and unsupported docs-sync asks still stay refusal baselines",
		])

	const providerConfigured =
		providerSelection.provider === "gemini" &&
		providerSelection.ready &&
		providerSelection.model === "gemini-2.5-flash"

	details.push(
		`provider=${providerSelection.provider ?? "none"}`,
		`model=${providerSelection.model ?? "none"}`,
		`authMode=${providerSelection.authMode ?? "none"}`,
		`transport=${providerSelection.transport}`,
		`providerReady=${providerSelection.ready ? "yes" : "no"}`,
	)

	let supportedRowsObserved = false
	if (providerConfigured) {
		const env = { ...process.env, ...providerSelection.envOverrides }
		const rowObservations: QueenBeeLiveNaturalLanguageRowObservation[] = []
		for (const row of supportedNaturalLanguageRows()) {
			rowObservations.push(await observeSupportedRow(rootDir, row, env))
		}
		supportedRowsObserved = rowObservations.every((row) => row.passed)
		for (const row of rowObservations) {
			details.push(
				`${row.id}=${row.passed ? "PASS" : "FAIL"} family=${row.taskFamilyHint ?? "missing"} specialist=${row.selectedSpecialist ?? "missing"} compileMode=${row.compileMode ?? "missing"} clean=${row.repoCleanAfter ? "yes" : "no"} artifact=${row.artifactPath}`,
				...row.details.map((detail) => `${row.id}:${detail}`),
			)
		}
	} else {
		details.push(`providerReason=${providerSelection.reason}`)
	}

	return {
		packageScriptPresent,
		liveEvalMatrixAligned,
		liveEvidencePackAligned,
		naturalLanguagePackPresent,
		naturalLanguageContractAligned,
		reproAligned,
		sideBySideAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		providerConfigured,
		supportedRowsObserved,
		refusalBaselinesDocumented,
		details,
	}
}

export function formatQueenBeeLiveNaturalLanguageHarnessResult(result: QueenBeeLiveNaturalLanguageHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Live eval matrix aligned: ${result.liveEvalMatrixAligned ? "PASS" : "FAIL"}`,
		`Live evidence pack aligned: ${result.liveEvidencePackAligned ? "PASS" : "FAIL"}`,
		`Natural-language pack present: ${result.naturalLanguagePackPresent ? "PASS" : "FAIL"}`,
		`Natural-language contract aligned: ${result.naturalLanguageContractAligned ? "PASS" : "FAIL"}`,
		`Repro aligned: ${result.reproAligned ? "PASS" : "FAIL"}`,
		`Side-by-side aligned: ${result.sideBySideAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Provider configured: ${result.providerConfigured ? "PASS" : "FAIL"}`,
		`Supported rows observed: ${result.supportedRowsObserved ? "PASS" : "FAIL"}`,
		`Refusal baselines documented: ${result.refusalBaselinesDocumented ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLiveNaturalLanguageHarness()
	console.log(formatQueenBeeLiveNaturalLanguageHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.liveEvalMatrixAligned &&
			result.liveEvidencePackAligned &&
			result.naturalLanguagePackPresent &&
			result.naturalLanguageContractAligned &&
			result.reproAligned &&
			result.sideBySideAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.providerConfigured &&
			result.supportedRowsObserved &&
			result.refusalBaselinesDocumented
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live:natural-language] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
