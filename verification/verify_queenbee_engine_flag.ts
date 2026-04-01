import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { resolveEngineSelection } from "../src/engine/EngineSelection"
import { formatQueenBeeCandidateBoundaryMessage, runQueenBeeRuntime } from "../src/queenbee/QueenBeeRuntime"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeEngineFlagHarnessResult = {
	defaultEngineIsSwarmengine: boolean
	explicitFlagsAccepted: boolean
	invalidEngineRejected: boolean
	queenBeeRuntimeFailsClosed: boolean
	cliRejectsInvalidEngine: boolean
	cliQueenBeeBoundaryVisible: boolean
	docsAligned: boolean
	packageScriptPresent: boolean
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
		const stdoutPath = path.join(tmpDir, `queenbee-engine-flag-${stamp}.stdout.log`)
		const stderrPath = path.join(tmpDir, `queenbee-engine-flag-${stamp}.stderr.log`)
		const stdoutFd = fs.openSync(stdoutPath, "w")
		const stderrFd = fs.openSync(stderrPath, "w")
		const readTextFile = (filePath: string): string => {
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
				// ignore best-effort cleanup failures
			}
			try {
				fs.closeSync(stderrFd)
			} catch {
				// ignore best-effort cleanup failures
			}
			try {
				fs.unlinkSync(stdoutPath)
			} catch {
				// ignore best-effort cleanup failures
			}
			try {
				fs.unlinkSync(stderrPath)
			} catch {
				// ignore best-effort cleanup failures
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
			const stdout = readTextFile(stdoutPath)
			const stderr = readTextFile(stderrPath)
			cleanup()
			resolve({ code, stdout, stderr })
		})
	})
}

export async function runQueenBeeEngineFlagHarness(rootDir = resolveRootDir()): Promise<QueenBeeEngineFlagHarnessResult> {
	const details: string[] = []
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const defaultSelection = resolveEngineSelection(undefined)
	const swarmengineSelection = resolveEngineSelection("swarmengine")
	const queenbeeSelection = resolveEngineSelection("queenbee")

	const defaultEngineIsSwarmengine = defaultSelection.engine === "swarmengine" && defaultSelection.source === "default"
	const explicitFlagsAccepted =
		swarmengineSelection.engine === "swarmengine" &&
		swarmengineSelection.source === "flag" &&
		queenbeeSelection.engine === "queenbee" &&
		queenbeeSelection.source === "flag"

	let invalidEngineRejected = false
	try {
		resolveEngineSelection("routerbee")
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		invalidEngineRejected = message.includes("unsupported --engine value") && message.includes("swarmengine") && message.includes("queenbee")
		details.push(`invalidEngineMessage=${message}`)
	}

	const queenbeeRuntimeResult = await runQueenBeeRuntime({
		engine: "queenbee",
		workspace: rootDir,
		dryRun: true,
		allowDirty: false,
		task: "add a brief comment to hello.ts",
		taskContract: null,
	})
	const queenbeeBoundaryMessage = formatQueenBeeCandidateBoundaryMessage({
		engine: "queenbee",
		workspace: rootDir,
		dryRun: true,
		allowDirty: false,
		task: "add a brief comment to hello.ts",
		taskContract: null,
	})
	const queenBeeRuntimeFailsClosed =
		queenbeeRuntimeResult.engine === "queenbee" &&
		queenbeeRuntimeResult.status === "candidate_not_ready" &&
		queenbeeRuntimeResult.stopReason === "candidate_engine_not_ready" &&
		includesAll(queenbeeRuntimeResult.message, [
			"`queenbee` remains experimental.",
			"Current bounded beta families:",
			"Current bounded candidate hint: comment_file over hello.ts.",
		]) &&
		includesNone(queenbeeRuntimeResult.message, ["RouterBee", "RegistryBee", "scaffolding"]) &&
		queenbeeRuntimeResult.message === queenbeeBoundaryMessage

	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:engine-flag"] === "npm run build && node dist/verification/verify_queenbee_engine_flag.js"

	const docsAligned =
		includesAll(readmeText, ["verify:queenbee:engine-flag", "explicit engine split", "`swarmengine`", "`queenbee`"]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee selection uses an explicit fail-closed runtime boundary",
			"**Session:** 187",
			"`swarmengine` stays the default",
			"`queenbee` gets its own candidate runtime entry point",
		]) &&
		includesAll(firstSliceText, ["`verify:queenbee:engine-flag`", "fail-closed", "separate task runtime entry points", "`verify:queenbee:ux`"]) &&
		includesAll(candidateText, ["fail-closed", "`npm.cmd run verify:queenbee:engine-flag`", "`npm.cmd run verify:queenbee:ux`"]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:engine-flag`", "explicit engine split stays visible"])

	let cliRejectsInvalidEngine = false
	let cliQueenBeeBoundaryVisible = false
	const cliFixture = await createTempTestRepoCopy(rootDir, "queenbee-engine-flag")
	try {
		const invalidCli = await runCli(rootDir, [
			"--engine",
			"routerbee",
			"--task",
			"add a brief comment to hello.ts",
			"--workspace",
			cliFixture.repoPath,
		])
		cliRejectsInvalidEngine =
			invalidCli.code === 1 &&
			invalidCli.stderr.includes('unsupported --engine value "routerbee"') &&
			invalidCli.stderr.includes("swarmengine") &&
			invalidCli.stderr.includes("queenbee")
		details.push(`cliInvalidCode=${String(invalidCli.code)}`)

		const queenbeeCli = await runCli(rootDir, [
			"--engine",
			"queenbee",
			"--task",
			"add a brief comment to hello.ts",
			"--workspace",
			cliFixture.repoPath,
			"--dryRun",
		])
		cliQueenBeeBoundaryVisible =
			queenbeeCli.code === 1 &&
			queenbeeCli.stdout.includes("[Swarm] Engine: queenbee (explicit)") &&
			queenbeeCli.stdout.includes("[Swarm] Final status: candidate_not_ready") &&
			queenbeeCli.stdout.includes("QueenBee candidate runtime selected.") &&
			queenbeeCli.stdout.includes("Current bounded candidate hint: comment_file over hello.ts.") &&
			queenbeeCli.stdout.includes("Current bounded beta families: comment_file, update_named_file, bounded_two_file_update, update_file_and_test, rename_export, bounded_node_cli_task.") &&
			includesNone(queenbeeCli.stdout, ["RouterBee", "RegistryBee", "scaffolding"]) &&
			queenbeeCli.stderr.includes("[Swarm] Engine not ready.")
		details.push(`cliQueenBeeCode=${String(queenbeeCli.code)}`)
	} finally {
		cliFixture.cleanup()
	}

	return {
		defaultEngineIsSwarmengine,
		explicitFlagsAccepted,
		invalidEngineRejected,
		queenBeeRuntimeFailsClosed,
		cliRejectsInvalidEngine,
		cliQueenBeeBoundaryVisible,
		docsAligned,
		packageScriptPresent,
		details,
	}
}

export function formatQueenBeeEngineFlagHarnessResult(result: QueenBeeEngineFlagHarnessResult): string {
	return [
		`Default engine remains swarmengine: ${result.defaultEngineIsSwarmengine ? "PASS" : "FAIL"}`,
		`Explicit engine flags accepted: ${result.explicitFlagsAccepted ? "PASS" : "FAIL"}`,
		`Invalid engine rejected: ${result.invalidEngineRejected ? "PASS" : "FAIL"}`,
		`QueenBee runtime fails closed: ${result.queenBeeRuntimeFailsClosed ? "PASS" : "FAIL"}`,
		`CLI rejects invalid engine: ${result.cliRejectsInvalidEngine ? "PASS" : "FAIL"}`,
		`CLI QueenBee boundary visible: ${result.cliQueenBeeBoundaryVisible ? "PASS" : "FAIL"}`,
		`Docs aligned: ${result.docsAligned ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeEngineFlagHarness()
	console.log(formatQueenBeeEngineFlagHarnessResult(result))
	process.exit(
		result.defaultEngineIsSwarmengine &&
			result.explicitFlagsAccepted &&
			result.invalidEngineRejected &&
			result.queenBeeRuntimeFailsClosed &&
			result.cliRejectsInvalidEngine &&
			result.cliQueenBeeBoundaryVisible &&
			result.docsAligned &&
			result.packageScriptPresent
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:engine-flag] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
