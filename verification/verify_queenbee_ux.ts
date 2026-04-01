import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { evaluateTaskAdmission } from "../src/run/AdmissionGate"
import { formatQueenBeeCandidateBoundaryMessage } from "../src/queenbee/QueenBeeRuntime"
import { createTempTestRepoCopy, runVerificationGit } from "./test_workspace_baseline"

export type QueenBeeUxHarnessResult = {
	uxDocsPresent: boolean
	publicDocsTruthful: boolean
	packageScriptPresent: boolean
	runtimeMessageCalmer: boolean
	runtimeMessageTruthful: boolean
	cliFamilyHintVisible: boolean
	cliCeremonyReduced: boolean
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

function includesNone(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => !text.includes(snippet))
}

async function runCli(rootDir: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		const tmpDir = path.join(rootDir, ".swarm", "tmp")
		fs.mkdirSync(tmpDir, { recursive: true })
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
		const stdoutPath = path.join(tmpDir, `queenbee-ux-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-ux-${stamp}.stderr.log`)
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
			env: process.env,
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

export async function runQueenBeeUxHarness(rootDir = resolveRootDir()): Promise<QueenBeeUxHarnessResult> {
	const details: string[] = []
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const uxReviewText = readText(rootDir, "QUEENBEE_UX_REVIEW_NOTES.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const publicReadmeText = readText(rootDir, "public_pack/README.md")
	const publicQuickstartText = readText(rootDir, "public_pack/QUICKSTART.md")
	const publicTaskFamiliesText = readText(rootDir, "public_pack/docs/task-families.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const uxDocsPresent =
		includesAll(readmeText, [
			"Session 212 bounded beta polish:",
			"`npm.cmd run verify:queenbee:jsts:file-and-test`",
			"`npm.cmd run verify:queenbee:ux`",
			"candidate_not_ready",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 212 makes update_file_and_test live in the bounded coder slot and removes stale CLI scaffolding copy",
			"bounded-family hint",
			"## Decision: Session 275 carries one calmer anchor-first helper/test phrasing across the bounded natural-language hold and UX surfaces",
		]) &&
		includesAll(candidateText, ["`npm.cmd run verify:queenbee:engine-flag`", "`npm.cmd run verify:queenbee:ux`"]) &&
		includesAll(firstSliceText, [
			"## Session 212 Update File And Test Lane",
			"`verify:queenbee:ux`",
			"stale shell-scaffolding jargon",
		]) &&
		includesAll(uxReviewText, [
			"## Session 212 Candidate CLI Boundary Review",
			"`npm.cmd run verify:queenbee:ux`",
			"bounded family hint",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:ux`",
			"stale shell-scaffolding jargon",
			"the Session 275 expert helper/test intake hardening now carries one calmer anchor-first helper/test phrasing",
		])
	const publicDocsTruthful =
		includesAll(publicReadmeText, ["bounded source-and-test pairs where you name the source file and its direct local test"]) &&
		includesAll(publicQuickstartText, ["for source-and-test work, name one source file and its direct local test file"]) &&
		includesAll(publicTaskFamiliesText, ["For `update_file_and_test`, name one source file and one direct local test file."])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:ux"] === "npm run build && node dist/verification/verify_queenbee_ux.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-ux")
	try {
		const sourcePath = path.join(fixture.repoPath, "src", "format.ts")
		const testPath = path.join(fixture.repoPath, "src", "format.test.ts")
		fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
		fs.writeFileSync(sourcePath, `export function formatLine(input: string): string {\n\treturn input.trim()\n}\n`, "utf8")
		fs.writeFileSync(testPath, `import { formatLine } from "./format"\n\nexport const actual = formatLine(" hello ")\n`, "utf8")
		await runVerificationGit(fixture.repoPath, ["add", "-A"])
		await runVerificationGit(fixture.repoPath, ["commit", "-m", "verification queenbee ux baseline"])

		const task = "update src/format.ts and keep its direct local test aligned"
		const admission = evaluateTaskAdmission(task, fixture.repoPath)
		const runtimeMessage = formatQueenBeeCandidateBoundaryMessage({
			engine: "queenbee",
			workspace: fixture.repoPath,
			dryRun: true,
			allowDirty: false,
			task,
			taskContract: admission.derivedTaskContract,
		})
		const runtimeMessageCalmer =
			includesAll(runtimeMessage, [
				"QueenBee candidate runtime selected.",
				"`queenbee` remains experimental.",
				"Current bounded beta families:",
				"Current bounded candidate hint: update_file_and_test over src/format.ts, src/format.test.ts.",
				"Preview scope: src/format.ts, src/format.test.ts.",
				"Timestamped progress preview:",
				"Preview headline: proposal in specialist_queue; next proposal via JSTSTestBee, but the candidate runtime stops before live execution.",
				"Preview stage: proposal (specialist_queue).",
				"Selected specialist: JSTSTestBee.",
			]) &&
			includesNone(runtimeMessage, ["RouterBee", "RegistryBee", "Session 187", "scaffolding"])
		const runtimeMessageTruthful =
			runtimeMessage.includes("`swarmengine` remains the shipped bounded engine.") &&
			runtimeMessage.includes("Use `--engine swarmengine`")

		const cliResult = await runCli(rootDir, ["--engine", "queenbee", "--task", task, "--workspace", fixture.repoPath, "--dryRun"])
		const cliFamilyHintVisible =
			cliResult.code === 1 &&
			cliResult.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			cliResult.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			cliResult.stdout.includes("Current bounded candidate hint: update_file_and_test over src/format.ts, src/format.test.ts.") &&
			cliResult.stdout.includes("Preview scope: src/format.ts, src/format.test.ts.") &&
			cliResult.stdout.includes("Current bounded beta families: comment_file, update_named_file, bounded_two_file_update, update_file_and_test, rename_export, bounded_node_cli_task.") &&
			cliResult.stdout.includes("Timestamped progress preview:") &&
			cliResult.stdout.includes("Preview headline: proposal in specialist_queue; next proposal via JSTSTestBee, but the candidate runtime stops before live execution.") &&
			cliResult.stdout.includes("Selected specialist: JSTSTestBee.") &&
			cliResult.stdout.includes("Progress artifact:") &&
			cliResult.stderr.includes("[Swarm] Engine not ready.")
		const cliCeremonyReduced =
			includesNone(`${cliResult.stdout}\n${cliResult.stderr}`, ["RouterBee", "RegistryBee", "Session 187", "no QueenBee task execution was attempted"]) &&
			cliResult.stdout.includes("`swarmengine` remains the shipped bounded engine.")

		details.push(
			`admissionDecision=${admission.decision}`,
			`runtimeMessage=${runtimeMessage.replace(/\r?\n/g, " | ")}`,
			`cliCode=${String(cliResult.code)}`,
		)

		return {
			uxDocsPresent,
			publicDocsTruthful,
			packageScriptPresent,
			runtimeMessageCalmer,
			runtimeMessageTruthful,
			cliFamilyHintVisible,
			cliCeremonyReduced,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeUxHarnessResult(result: QueenBeeUxHarnessResult): string {
	return [
		`UX docs present: ${result.uxDocsPresent ? "PASS" : "FAIL"}`,
		`Public docs truthful: ${result.publicDocsTruthful ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Runtime message calmer: ${result.runtimeMessageCalmer ? "PASS" : "FAIL"}`,
		`Runtime message truthful: ${result.runtimeMessageTruthful ? "PASS" : "FAIL"}`,
		`CLI family hint visible: ${result.cliFamilyHintVisible ? "PASS" : "FAIL"}`,
		`CLI ceremony reduced: ${result.cliCeremonyReduced ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeUxHarness()
	console.log(formatQueenBeeUxHarnessResult(result))
	process.exit(
		result.uxDocsPresent &&
			result.publicDocsTruthful &&
			result.packageScriptPresent &&
			result.runtimeMessageCalmer &&
			result.runtimeMessageTruthful &&
			result.cliFamilyHintVisible &&
			result.cliCeremonyReduced
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:ux] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
