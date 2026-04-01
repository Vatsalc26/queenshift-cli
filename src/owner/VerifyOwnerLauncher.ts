import fs from "node:fs"
import path from "node:path"

import { formatOwnerGuidedDemoResult, runOwnerGuidedDemo } from "./OwnerGuidedDemo"
import {
	OWNER_GUIDED_DEMO_MODEL,
	OWNER_GUIDED_DEMO_PROFILE_ID,
	OWNER_GUIDED_DEMO_TIMEOUT_MS,
	OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH,
} from "./OwnerProfileManifest"

export type OwnerLauncherHarnessResult = {
	canonicalWorkspaceSelected: boolean
	canonicalProviderDefaultsApplied: boolean
	passOutputCompact: boolean
	failureOutputCompact: boolean
	manifestExposed: boolean
	details: string[]
}

function createHarnessRoot(): { rootDir: string; workspace: string; oauthPath: string; cleanup: () => void } {
	const rootDir = path.join(__dirname, "..", "..", "verification", `.tmp-owner-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const workspace = path.join(rootDir, OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH)
	const oauthDir = path.join(rootDir, ".tmp-oauth")
	const oauthPath = path.join(oauthDir, "oauth_creds.json")

	fs.mkdirSync(path.join(rootDir, "dist"), { recursive: true })
	fs.mkdirSync(workspace, { recursive: true })
	fs.mkdirSync(oauthDir, { recursive: true })
	fs.writeFileSync(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "owner-launcher-harness" }, null, 2)}\n`, "utf8")
	fs.writeFileSync(path.join(rootDir, "dist", "swarm.js"), "console.log('fixture')\n", "utf8")
	fs.writeFileSync(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`, "utf8")

	return {
		rootDir,
		workspace,
		oauthPath,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

export async function runOwnerLauncherHarness(): Promise<OwnerLauncherHarnessResult> {
	const harness = createHarnessRoot()
	const details: string[] = []
	let observedCommand = ""
	let observedEnv: Record<string, string> = {}

	try {
		const success = await runOwnerGuidedDemo(
			harness.rootDir,
			{ GEMINI_CLI_OAUTH_PATH: harness.oauthPath },
			{
				prepareWorkspace: async () => {},
				executeLaunch: async (spec) => {
					observedCommand = spec.displayCommand
					observedEnv = { ...(spec.envOverrides ?? {}) }
					return { code: 0, stdout: "[Swarm] Final status: done", stderr: "" }
				},
				readLatestArtifact: () => ({
					summaryPath: path.join(harness.workspace, ".swarm", "runs", "task-pass", "summary.json"),
					summary: {
						taskId: "task-pass",
						status: "done",
						stopReason: "completed",
						reviewerVerdict: "PASS",
						acceptanceGate: { passed: true },
					},
				}),
			},
		)
		const successText = formatOwnerGuidedDemoResult(success)

		const failure = await runOwnerGuidedDemo(
			harness.rootDir,
			{ GEMINI_CLI_OAUTH_PATH: harness.oauthPath },
			{
				prepareWorkspace: async () => {},
				executeLaunch: async () => ({ code: 1, stdout: "simulated child output\nat fake stack", stderr: "trace" }),
				readLatestArtifact: () => ({
					summaryPath: path.join(harness.workspace, ".swarm", "runs", "task-fail", "summary.json"),
					summary: {
						taskId: "task-fail",
						status: "failed",
						stopReason: "provider_auth_failure",
						reviewerVerdict: "missing",
						acceptanceGate: { passed: false },
					},
				}),
				buildIncident: async () => ({
					incidentPackPath: path.join(harness.workspace, ".swarm", "runs", "task-fail", "incident-pack.json"),
					nextAction: "investigate provider/auth setup",
					nextActionRationale: "The first useful step is to fix provider configuration before retrying.",
				}),
			},
		)
		const failureText = formatOwnerGuidedDemoResult(failure)

		const canonicalWorkspaceSelected = success.workspace === harness.workspace
		const canonicalProviderDefaultsApplied =
			observedEnv["SWARM_PROVIDER"] === "gemini" &&
			observedEnv["SWARM_GEMINI_AUTH"] === "cli" &&
			observedEnv["SWARM_MODEL"] === OWNER_GUIDED_DEMO_MODEL &&
			observedEnv["GEMINI_CLI_TIMEOUT_MS"] === String(OWNER_GUIDED_DEMO_TIMEOUT_MS) &&
			observedEnv["SWARM_RUN_SURFACE"] === "owner_guided_demo" &&
			observedCommand.includes("--provider gemini") &&
			observedCommand.includes(`--model ${OWNER_GUIDED_DEMO_MODEL}`)
		const passOutputCompact =
			successText.includes("Owner guided demo: PASS") &&
			successText.includes("Summary:") &&
			successText.includes("Credit lane: non-credit") &&
			!successText.includes("Raw output:")
		const failureOutputCompact =
			failureText.includes("Owner guided demo: FAIL") &&
			failureText.includes("Failing step: run_result") &&
			failureText.includes("Incident:") &&
			failureText.includes("Next action: investigate provider/auth setup") &&
			!failureText.includes("at fake stack") &&
			!failureText.includes("Raw output:")
		const manifestExposed =
			successText.includes(`Profile: ${OWNER_GUIDED_DEMO_PROFILE_ID}`) && successText.includes("Manifest hash:")

		details.push(`workspace=${success.workspace}`, `command=${observedCommand}`)

		return {
			canonicalWorkspaceSelected,
			canonicalProviderDefaultsApplied,
			passOutputCompact,
			failureOutputCompact,
			manifestExposed,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatOwnerLauncherHarnessResult(result: OwnerLauncherHarnessResult): string {
	return [
		`Canonical workspace selected: ${result.canonicalWorkspaceSelected ? "PASS" : "FAIL"}`,
		`Canonical provider defaults applied: ${result.canonicalProviderDefaultsApplied ? "PASS" : "FAIL"}`,
		`PASS output stays compact: ${result.passOutputCompact ? "PASS" : "FAIL"}`,
		`FAIL output stays compact: ${result.failureOutputCompact ? "PASS" : "FAIL"}`,
		`Manifest exposed in output: ${result.manifestExposed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerLauncherHarness()
	console.log(formatOwnerLauncherHarnessResult(result))
	process.exit(
		result.canonicalWorkspaceSelected &&
			result.canonicalProviderDefaultsApplied &&
			result.passOutputCompact &&
			result.failureOutputCompact &&
			result.manifestExposed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:launcher] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}

