import fs from "node:fs"
import path from "node:path"

import {
	DEMO_REPO_PACK_RESET_COMMAND,
	DEMO_REPO_PACK_SURFACE,
	DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH,
	DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH,
	formatDemoRepoPackResult,
	formatDemoRepoResetResult,
	resetDemoRepoPack,
	runDemoRepoPack,
} from "../src/owner/DemoRepoPack"
import { OWNER_GUIDED_DEMO_MODEL, OWNER_GUIDED_DEMO_TIMEOUT_MS } from "../src/owner/OwnerProfileManifest"

export type DemoRunHarnessResult = {
	disposableWorkspaceStaged: boolean
	resetRemovesPreviousDrift: boolean
	frozenProviderDefaultsApplied: boolean
	realLauncherHandoffWorks: boolean
	passOutputShowsArtifactsAndDiffs: boolean
	failOutputStaysCompact: boolean
	resetOutputUseful: boolean
	lowSteeringLoopVisible: boolean
	details: string[]
}

function writeFile(filePath: string, contents: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, contents, "utf8")
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function buildFixtureCliScript(): string {
	return [
		"#!/usr/bin/env node",
		"const fs = require('node:fs')",
		"const path = require('node:path')",
		"const args = process.argv.slice(2)",
		"const workspaceIndex = args.indexOf('--workspace')",
		"if (workspaceIndex === -1 || !args[workspaceIndex + 1]) {",
		"\tconsole.error('workspace missing')",
		"\tprocess.exit(1)",
		"}",
		"const workspace = path.resolve(args[workspaceIndex + 1])",
		"const runDir = path.join(workspace, '.swarm', 'runs', 'fixture-live-pass')",
		"fs.mkdirSync(runDir, { recursive: true })",
		"const helloPath = path.join(workspace, 'hello.ts')",
		"if (fs.existsSync(helloPath)) {",
		"\tconst original = fs.readFileSync(helloPath, 'utf8')",
		"\tif (!original.includes('// fixture launch comment')) {",
		"\t\tfs.writeFileSync(helloPath, `${original.trimEnd()}\\n// fixture launch comment\\n`, 'utf8')",
		"\t}",
		"}",
		"const summary = {",
		"\ttaskId: 'fixture-live-pass',",
		"\tstatus: 'done',",
		"\tstopReason: 'completed',",
		"\treviewerVerdict: 'PASS',",
		"\tacceptanceGate: { passed: true },",
		"\tchangedFiles: ['hello.ts'],",
		"\tfastLane: {",
		"\t\tlaneId: 'simple_task_fast_lane',",
		"\t\tpredictability: 'high',",
		"\t\texpectedWorkItems: 1,",
		"\t\texpectedBuilderCount: 1,",
		"\t},",
		"\treplayOverview: {",
		"\t\tplanningSummary: 'lane=small_task workItems=1 merge=not_applicable/not_applicable',",
		"\t\tcoordinationSummary: 'ready=assign-comment blocked=(none) released=(none) stages=1',",
		"\t\treviewSummary: 'critic=not_required verdict=PASS acceptance=passed verification=not recorded retry=not recorded',",
		"\t\thighlights: ['Terminal: done (completed)'],",
		"\t},",
		"}",
		"fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\\n`, 'utf8')",
		"console.log('[Swarm] Fixture launched via real child process')",
		"console.log('[Swarm] Final status: done')",
	].join('\n')
}

function createHarnessRoot(): { rootDir: string; oauthPath: string; cleanup: () => void } {
	const rootDir = path.join(resolveRootDir(), "verification", `.tmp-demo-run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const templateDir = path.join(rootDir, DEMO_REPO_PACK_TEMPLATE_RELATIVE_PATH)
	const oauthDir = path.join(rootDir, ".tmp-oauth")
	const oauthPath = path.join(oauthDir, "oauth_creds.json")

	writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "demo-run-harness" }, null, 2)}\n`)
	writeFile(path.join(rootDir, "dist", "swarm.js"), `${buildFixtureCliScript()}\n`)
	writeFile(path.join(templateDir, "hello.ts"), "export function greet(name: string): string {\n\treturn `Hello, ${name}!`\n}\n")
	writeFile(path.join(templateDir, "utils.ts"), "export function shout(input: string): string {\n\treturn input.toUpperCase()\n}\n")
	writeFile(
		path.join(templateDir, "package.json"),
		`${JSON.stringify({ name: "demo-pack-harness", private: true, type: "module" }, null, 2)}\n`,
	)
	writeFile(
		path.join(templateDir, "README.md"),
		"# Demo repo pack\n\nThis repo is disposable and non-production by design.\n",
	)
	writeFile(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`)

	return {
		rootDir,
		oauthPath,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

export async function runDemoRunHarness(): Promise<DemoRunHarnessResult> {
	const harness = createHarnessRoot()
	const details: string[] = []
	let observedCommand = ""
	let observedEnv: Record<string, string> = {}

	try {
		const reset = await resetDemoRepoPack(harness.rootDir)
		const stagedWorkspace = path.join(harness.rootDir, DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH)
		writeFile(path.join(stagedWorkspace, "stray.txt"), "temporary drift\n")

		const success = await runDemoRepoPack(
			harness.rootDir,
			{ GEMINI_CLI_OAUTH_PATH: harness.oauthPath },
			{
				executeLaunch: async (spec) => {
					observedCommand = spec.displayCommand
					observedEnv = { ...(spec.envOverrides ?? {}) }
					return { code: 0, stdout: "[Swarm] Final status: done", stderr: "" }
				},
				readLatestArtifact: (workspace) => ({
					summaryPath: path.join(workspace, ".swarm", "runs", "demo-pass", "summary.json"),
					summary: {
						taskId: "demo-pass",
						status: "done",
						stopReason: "completed",
						reviewerVerdict: "PASS",
						acceptanceGate: { passed: true },
						changedFiles: ["hello.ts"],
						fastLane: {
							laneId: "simple_task_fast_lane",
							predictability: "high",
							expectedWorkItems: 1,
							expectedBuilderCount: 1,
						},
						replayOverview: {
							planningSummary: "lane=small_task workItems=1 merge=not_applicable/not_applicable",
							coordinationSummary: "ready=assign-comment blocked=(none) released=(none) stages=1",
							reviewSummary: "critic=not_required verdict=PASS acceptance=passed verification=not recorded retry=not recorded",
							highlights: ["Terminal: done (completed)"],
						},
					},
				}),
				readGitState: async (workspace) => ({
					latestCommit: "abc1234 demo: add hello comment",
					diffCommand: `git -C "${workspace}" show --stat HEAD`,
				}),
			},
		)
		const successText = formatDemoRepoPackResult(success)

		writeFile(path.join(stagedWorkspace, "stray-2.txt"), "temporary drift 2\n")
		const failure = await runDemoRepoPack(
			harness.rootDir,
			{ GEMINI_CLI_OAUTH_PATH: harness.oauthPath },
			{
				executeLaunch: async () => ({ code: 1, stdout: "simulated child output\nat fake stack", stderr: "trace" }),
				readLatestArtifact: (workspace) => ({
					summaryPath: path.join(workspace, ".swarm", "runs", "demo-fail", "summary.json"),
					summary: {
						taskId: "demo-fail",
						status: "failed",
						stopReason: "provider_auth_failure",
						reviewerVerdict: "missing",
						acceptanceGate: { passed: false },
						changedFiles: [],
						fastLane: {
							laneId: "simple_task_fast_lane",
							predictability: "high",
							expectedWorkItems: 1,
							expectedBuilderCount: 1,
						},
						replayOverview: {
							planningSummary: "lane=small_task workItems=1 merge=not_applicable/not_applicable",
							coordinationSummary: "ready=(not recorded) blocked=(not recorded) released=(not recorded) stages=0",
							reviewSummary: "critic=not recorded verdict=missing acceptance=failed verification=not recorded retry=not recorded",
							highlights: ["Terminal: failed (provider_auth_failure)"],
						},
					},
				}),
				buildIncident: async (workspace) => ({
					incidentPackPath: path.join(workspace, ".swarm", "runs", "demo-fail", "incident-pack.json"),
					nextAction: "inspect provider/auth setup",
					nextActionRationale: "The disposable demo lane should stay on the frozen known-good provider path.",
				}),
				readGitState: async (workspace) => ({
					latestCommit: "abc1234 demo: baseline",
					diffCommand: `git -C "${workspace}" show --stat HEAD`,
				}),
			},
		)
		const failureText = formatDemoRepoPackResult(failure)
		const resetText = formatDemoRepoResetResult(reset)
		const realLaunch = await runDemoRepoPack(harness.rootDir, { GEMINI_CLI_OAUTH_PATH: harness.oauthPath })

		const disposableWorkspaceStaged =
			reset.passed &&
			success.workspace === stagedWorkspace &&
			fs.existsSync(path.join(stagedWorkspace, ".git")) &&
			fs.existsSync(path.join(stagedWorkspace, "hello.ts"))
		const resetRemovesPreviousDrift =
			!fs.existsSync(path.join(stagedWorkspace, "stray.txt")) && !fs.existsSync(path.join(stagedWorkspace, "stray-2.txt"))
		const frozenProviderDefaultsApplied =
			observedEnv["SWARM_PROVIDER"] === "gemini" &&
			observedEnv["SWARM_GEMINI_AUTH"] === "cli" &&
			observedEnv["SWARM_MODEL"] === OWNER_GUIDED_DEMO_MODEL &&
			observedEnv["GEMINI_CLI_TIMEOUT_MS"] === String(OWNER_GUIDED_DEMO_TIMEOUT_MS) &&
			observedEnv["SWARM_RUN_SURFACE"] === DEMO_REPO_PACK_SURFACE &&
			observedCommand.includes("--provider gemini") &&
			observedCommand.includes(`--model ${OWNER_GUIDED_DEMO_MODEL}`)
		const realLauncherHandoffWorks =
			realLaunch.passed &&
			realLaunch.failingStep === null &&
			(realLaunch.summaryPath ?? "").includes(path.join(".swarm", "runs", "fixture-live-pass", "summary.json")) &&
			realLaunch.rawOutput.includes("Fixture launched via real child process") &&
			realLaunch.rawOutput.includes("[Swarm] Final status: done") &&
			realLaunch.changedFiles.includes("hello.ts")
		const passOutputShowsArtifactsAndDiffs =
			successText.includes("Disposable demo: PASS") &&
			successText.includes("Summary:") &&
			successText.includes("Changed files: hello.ts") &&
			successText.includes("Fast lane: simple_task_fast_lane") &&
			successText.includes("Replay overview:") &&
			successText.includes("Replay highlights: Terminal: done (completed)") &&
			successText.includes("Diff command:") &&
			successText.includes("Replay command:") &&
			successText.includes(`Reset command: ${DEMO_REPO_PACK_RESET_COMMAND}`) &&
			successText.includes("Manifest hash:") &&
			!successText.includes("Raw output:")
		const failOutputStaysCompact =
			failureText.includes("Disposable demo: FAIL") &&
			failureText.includes("Incident:") &&
			failureText.includes("Next action: inspect provider/auth setup") &&
			failureText.includes("Incident command:") &&
			failureText.includes("Provider diagnose: queenshift doctor") &&
			!failureText.includes("at fake stack") &&
			!failureText.includes("Raw output:")
		const resetOutputUseful =
			resetText.includes("Demo workspace reset: PASS") &&
			resetText.includes("Workspace:") &&
			resetText.includes("Baseline commit:")
		const lowSteeringLoopVisible =
			successText.includes("Low-steering loop:") &&
			successText.includes("owner:guided:demo") &&
			successText.includes("owner:life-signal") &&
			successText.includes("owner:quick-actions") &&
			failureText.includes("Low-steering loop:") &&
			failureText.includes("demo:run")

		details.push(`workspace=${success.workspace}`, `command=${observedCommand}`, `realSummary=${realLaunch.summaryPath ?? "(missing)"}`)

		return {
			disposableWorkspaceStaged,
			resetRemovesPreviousDrift,
			frozenProviderDefaultsApplied,
			realLauncherHandoffWorks,
			passOutputShowsArtifactsAndDiffs,
			failOutputStaysCompact,
			resetOutputUseful,
			lowSteeringLoopVisible,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatDemoRunHarnessResult(result: DemoRunHarnessResult): string {
	return [
		`Disposable workspace staged: ${result.disposableWorkspaceStaged ? "PASS" : "FAIL"}`,
		`Reset removes previous drift: ${result.resetRemovesPreviousDrift ? "PASS" : "FAIL"}`,
		`Frozen provider defaults applied: ${result.frozenProviderDefaultsApplied ? "PASS" : "FAIL"}`,
		`Real launcher handoff works: ${result.realLauncherHandoffWorks ? "PASS" : "FAIL"}`,
		`PASS output shows artifacts and diff hints: ${result.passOutputShowsArtifactsAndDiffs ? "PASS" : "FAIL"}`,
		`FAIL output stays compact: ${result.failOutputStaysCompact ? "PASS" : "FAIL"}`,
		`Reset output is useful: ${result.resetOutputUseful ? "PASS" : "FAIL"}`,
		`Low-steering loop visible: ${result.lowSteeringLoopVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runDemoRunHarness()
	console.log(formatDemoRunHarnessResult(result))
	process.exit(
		result.disposableWorkspaceStaged &&
			result.resetRemovesPreviousDrift &&
			result.frozenProviderDefaultsApplied &&
			result.realLauncherHandoffWorks &&
			result.passOutputShowsArtifactsAndDiffs &&
			result.failOutputStaysCompact &&
			result.resetOutputUseful &&
			result.lowSteeringLoopVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:demo:run] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
