import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"
import { readRunSummary, findLatestRunSummary } from "../src/run/RunArtifacts"
import { readShellSnapshot } from "../src/shell/ThinShell"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"

type QueenBeeLiveFirstCanonicalObservation = {
	passed: boolean
	summaryPath: string | null
	archivePath: string | null
	details: string[]
}

export type QueenBeeLiveFirstCanonicalHarnessResult = {
	packageScriptPresent: boolean
	liveDocsPresent: boolean
	architectureDecisionRecorded: boolean
	verificationCatalogAligned: boolean
	capabilityChecklistAligned: boolean
	providerConfigured: boolean
	firstCanonicalRowObserved: boolean
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

async function commitFixtureChanges(repoPath: string, message: string): Promise<void> {
	const status = await runVerificationGit(repoPath, ["status", "--porcelain", "--untracked-files=all"])
	if (!status.trim()) return
	await runVerificationGit(repoPath, ["add", "-A"])
	await runVerificationGit(repoPath, ["commit", "-m", message])
}

async function setupAsyncFirstCanonicalFixture(repoPath: string): Promise<void> {
	const retryPath = path.join(repoPath, "src", "retry.ts")
	fs.mkdirSync(path.dirname(retryPath), { recursive: true })
	fs.writeFileSync(
		retryPath,
		'export async function retryWithBackoff<T>(work: () => Promise<T>): Promise<T> {\n\treturn await work()\n}\n',
		"utf8",
	)
	await commitFixtureChanges(repoPath, "verification first canonical async baseline")
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
		const stdoutPath = path.join(tmpDir, `queenbee-live-first-canonical-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-live-first-canonical-${stamp}.stderr.log`)
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

async function observeFirstCanonicalRow(
	rootDir: string,
	env: NodeJS.ProcessEnv,
): Promise<QueenBeeLiveFirstCanonicalObservation> {
	const details: string[] = []
	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-live-first-canonical")
	try {
		await setupAsyncFirstCanonicalFixture(fixture.repoPath)

		const task = 'add the exact comment "// queenbee: async retry live" to src/retry.ts'
		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath], env)
		const summaryPath = findLatestRunSummary(fixture.repoPath)
		const summary = summaryPath ? readRunSummary<Record<string, unknown>>(path.dirname(summaryPath)) : null
		const shellSnapshot = readShellSnapshot(fixture.repoPath)
		const repoStatus = await runVerificationGit(fixture.repoPath, ["status", "--porcelain", "--untracked-files=all"])
		const repoCleanAfter = repoStatus.trim().length === 0
		const retryPath = path.join(fixture.repoPath, "src", "retry.ts")
		const retryText = fs.readFileSync(retryPath, "utf8")
		const archivePath = typeof summary?.["queenbeeLive"] === "object"
			? (summary["queenbeeLive"] as Record<string, unknown>)["archivePath"]
			: null
		const archiveRelPath = typeof archivePath === "string" ? archivePath : null
		const archiveAbsolutePath = archiveRelPath ? path.join(fixture.repoPath, archiveRelPath) : ""
		const archiveJson =
			archiveAbsolutePath && fs.existsSync(archiveAbsolutePath)
				? (JSON.parse(fs.readFileSync(archiveAbsolutePath, "utf8")) as Record<string, unknown>)
				: null
		const queenbeeLive = typeof summary?.["queenbeeLive"] === "object" ? (summary["queenbeeLive"] as Record<string, unknown>) : null
		const provider = typeof summary?.["provider"] === "object" ? (summary["provider"] as Record<string, unknown>) : null
		const verificationProfile =
			typeof summary?.["verificationProfile"] === "object" ? (summary["verificationProfile"] as Record<string, unknown>) : null
		const candidateProgressPath = path.join(fixture.repoPath, ".swarm", "queenbee-candidate", "latest-progress.json")

		const cliAligned =
			cliResult.code === 0 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: done") &&
			cliResult.stdout.includes("[Swarm] QueenBee first canonical live row completed.") &&
			cliResult.stdout.includes("[Swarm] Live row: QB-LIVE-01 (comment_file) over src/retry.ts.") &&
			cliResult.stdout.includes("[Swarm] Selected specialist: JSTSAsyncBee.") &&
			cliResult.stdout.includes("[Swarm] Provider call observed: yes.") &&
			cliResult.stdout.includes("[Swarm] Proof commands: npm.cmd test.") &&
			!cliResult.stderr.includes("[Swarm] Engine not ready.")

		const summaryAligned =
			Boolean(summaryPath) &&
			summary?.["engine"] === "queenbee" &&
			summary?.["status"] === "done" &&
			summary?.["stopReason"] === "success" &&
			provider?.["providerCallObserved"] === true &&
			provider?.["provider"] === "gemini" &&
			provider?.["model"] === "gemini-2.5-flash" &&
			queenbeeLive?.["selectedSpecialist"] === "JSTSAsyncBee" &&
			queenbeeLive?.["taskFamily"] === "comment_file" &&
			Array.isArray(queenbeeLive?.["changedFiles"]) &&
			(queenbeeLive?.["changedFiles"] as string[]).join(",") === "src/retry.ts" &&
			Array.isArray(queenbeeLive?.["proofCommands"]) &&
			(queenbeeLive?.["proofCommands"] as string[]).join(",") === "npm.cmd test" &&
			verificationProfile?.["profileName"] === "queenbee_live_first_canonical" &&
			verificationProfile?.["status"] === "passed"

		const shellSnapshotAligned =
			Boolean(summaryPath) &&
			shellSnapshot.summaryPath === summaryPath &&
			shellSnapshot.summaryText.includes(`Artifact: ${summaryPath}`) &&
			shellSnapshot.summaryText.includes('"engine": "queenbee"') &&
			shellSnapshot.summaryText.includes('"status": "done"') &&
			shellSnapshot.summaryText.includes('"selectedSpecialist": "JSTSAsyncBee"') &&
			shellSnapshot.summaryText.includes('"providerCallObserved": true') &&
			shellSnapshot.forensicsText.includes("Terminal status: done") &&
			shellSnapshot.forensicsText.includes("Likely failure bucket: success")

		const archiveAligned =
			Boolean(archiveRelPath) &&
			Boolean(archiveJson) &&
			Boolean(archiveJson?.["assignmentId"]) &&
			Boolean(archiveJson?.["mergeSummary"]) &&
			Boolean(archiveJson?.["verifierSummary"])

		const passed =
			cliAligned &&
			summaryAligned &&
			shellSnapshotAligned &&
			archiveAligned &&
			repoCleanAfter &&
			retryText.includes("// queenbee: async retry live") &&
			!fs.existsSync(candidateProgressPath)

		details.push(
			`cliCode=${String(cliResult.code)}`,
			`summary=${summaryPath ?? "missing"}`,
			`archive=${archiveRelPath ?? "missing"}`,
			`repoCleanAfter=${repoCleanAfter ? "yes" : "no"}`,
			`stdout=${cliResult.stdout.replace(/\r?\n/g, " | ")}`,
		)

		return {
			passed,
			summaryPath,
			archivePath: archiveRelPath,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export async function runQueenBeeLiveFirstCanonicalHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeLiveFirstCanonicalHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const matrixText = readText(rootDir, "QUEENBEE_LIVE_EVAL_MATRIX.md")
	const canonicalPackText = readText(rootDir, "QUEENBEE_LIVE_CANONICAL_PACK.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const providerSelection = resolveOwnerProviderSelection(process.env)
	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:live:first-canonical"] ===
		"npm run build && node dist/verification/verify_queenbee_live_first_canonical.js"

	const liveDocsPresent =
		includesAll(matrixText, [
			"`QB-LIVE-01`",
			"Session 239 first live canonical row for `comment_file`, refreshed in Session 268 with one async-sensitive provider-backed observation",
			"`live_pass`",
			"`verify:queenbee:live:first-canonical`",
			"`JSTSAsyncBee`",
		]) &&
		includesAll(canonicalPackText, [
			"`QB-LIVE-01`",
			"`currentStatus`: `live_pass`",
			"`bounded_live_pass`",
			"`true`",
			"`npm.cmd test`",
			"`JSTSAsyncBee`",
			"`src/retry.ts`",
		])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 268 refreshes the first canonical live row around one async-specialist observation without widening the live gate",
		"**Session:** 268",
		"`QB-LIVE-01`",
		"`verify:queenbee:live:first-canonical`",
	])
	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:live:first-canonical`",
		"first canonical live row now records one async-sensitive provider-backed observation through `JSTSAsyncBee`",
	])
	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B58 |",
		"Does QueenBee still retain an async-specialist live canonical observation on `QB-LIVE-01` inside the wider canonical live pack? | YES |",
		"| YES |",
		"`npm.cmd run verify:queenbee:live:first-canonical`",
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

	let firstCanonicalRowObserved = false
	if (providerConfigured) {
		const observation = await observeFirstCanonicalRow(rootDir, {
			...process.env,
			...providerSelection.envOverrides,
		})
		firstCanonicalRowObserved = observation.passed
		details.push(
			`firstCanonicalRow=${observation.passed ? "PASS" : "FAIL"}`,
			...observation.details.map((detail) => `QB-LIVE-01:${detail}`),
		)
	} else {
		details.push(`providerReason=${providerSelection.reason}`)
	}

	return {
		packageScriptPresent,
		liveDocsPresent,
		architectureDecisionRecorded,
		verificationCatalogAligned,
		capabilityChecklistAligned,
		providerConfigured,
		firstCanonicalRowObserved,
		details,
	}
}

export function formatQueenBeeLiveFirstCanonicalHarnessResult(result: QueenBeeLiveFirstCanonicalHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Live docs present: ${result.liveDocsPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Provider configured: ${result.providerConfigured ? "PASS" : "FAIL"}`,
		`First canonical row observed: ${result.firstCanonicalRowObserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeLiveFirstCanonicalHarness()
	console.log(formatQueenBeeLiveFirstCanonicalHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.liveDocsPresent &&
			result.architectureDecisionRecorded &&
			result.verificationCatalogAligned &&
			result.capabilityChecklistAligned &&
			result.providerConfigured &&
			result.firstCanonicalRowObserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:live:first-canonical] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
