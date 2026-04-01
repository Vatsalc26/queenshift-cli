import fs from "node:fs"
import path from "node:path"

import { buildOwnerShellStatusText } from "../src/owner/OwnerStatus"
import { buildOwnerProviderDiagnostic, formatOwnerProviderDiagnostic, resolveOwnerProviderSelection } from "../src/owner/ProviderResolution"

export type OwnerProviderDefaultsHarnessResult = {
	geminiOauthPreferred: boolean
	geminiCliFallbackVisible: boolean
	geminiCliCommandPinned: boolean
	unconfiguredFailsClosed: boolean
	retryPolicySurfaced: boolean
	statusTextMakesProviderVisible: boolean
	diagnosticGuidanceVisible: boolean
	unconfiguredGuidanceVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

export async function runOwnerProviderDefaultsHarness(rootDir = resolveRootDir()): Promise<OwnerProviderDefaultsHarnessResult> {
	const details: string[] = []
	const oauthDir = path.join(rootDir, "verification", `.tmp-owner-provider-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const oauthPath = path.join(oauthDir, "oauth_creds.json")
	const fakeBinDir = path.join(oauthDir, "bin")
	const fakeGeminiName = process.platform === "win32" ? "gemini.cmd" : "gemini"
	const fakeGeminiPath = path.join(fakeBinDir, fakeGeminiName)
	fs.mkdirSync(oauthDir, { recursive: true })
	fs.mkdirSync(fakeBinDir, { recursive: true })
	fs.writeFileSync(oauthPath, `${JSON.stringify({ refresh_token: "fixture" }, null, 2)}\n`, "utf8")
	fs.writeFileSync(fakeGeminiPath, process.platform === "win32" ? "@echo off\r\necho fake gemini\r\n" : "#!/bin/sh\necho fake gemini\n", "utf8")

	try {
		const geminiSelection = resolveOwnerProviderSelection({
			GEMINI_CLI_OAUTH_PATH: oauthPath,
			GEMINI_CLI_COMMAND: "__missing_gemini_cli_for_owner_defaults__",
		})
		const geminiOauthPreferred =
			geminiSelection.provider === "gemini" &&
			geminiSelection.authMode === "cli" &&
			geminiSelection.ready === true
		const geminiCliFallbackVisible =
			geminiSelection.transport === "gemini_cli_oauth_http" &&
			geminiSelection.transportNote.includes("fall back to direct HTTPS")
		const retryPolicySurfaced =
			geminiSelection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] === "1" &&
			geminiSelection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] === "1500" &&
			geminiSelection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] === "300000"

		const cliPinnedSelection = resolveOwnerProviderSelection({
			GEMINI_CLI_OAUTH_PATH: oauthPath,
			GEMINI_CLI_COMMAND: fakeGeminiName,
			PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
			PATHEXT: process.env.PATHEXT,
		})
		const geminiCliCommandPinned =
			cliPinnedSelection.transport === "gemini_cli_subprocess" &&
			cliPinnedSelection.envOverrides["GEMINI_CLI_COMMAND"] === fakeGeminiPath

		const emptySelection = resolveOwnerProviderSelection({
			GEMINI_CLI_OAUTH_PATH: path.join(oauthDir, "missing-oauth-creds.json"),
		})
		const unconfiguredFailsClosed = emptySelection.provider === null && emptySelection.ready === false

		const statusText = buildOwnerShellStatusText({
			rootDir,
			workspace: "C:\\OwnerRepo",
			surface: "thin_shell_guided",
			providerSelection: geminiSelection,
			admissionText: "Admission decision: ALLOW\nRepo readiness: ALLOW\nTask admission: ALLOW",
			latestRunId: null,
		})
		const statusTextMakesProviderVisible =
			statusText.includes("Provider: gemini (cli)") &&
			statusText.includes("Provider source: detected_gemini_cli_oauth") &&
			statusText.includes("Provider transport: gemini_cli_oauth_http") &&
			statusText.includes("Provider retry policy: 1 retry attempt(s), 1500ms base backoff, 300000ms timeout")
		const diagnosticText = formatOwnerProviderDiagnostic(buildOwnerProviderDiagnostic(geminiSelection))
		const diagnosticGuidanceVisible =
			diagnosticText.includes("Next steps:") &&
			diagnosticText.includes("queenshift owner:guided:demo") &&
			diagnosticText.includes("queenshift demo:run") &&
			diagnosticText.includes("queenshift repo:onboard --workspace <repo>") &&
			diagnosticText.includes("Current retry policy: 1 retry attempt(s), 1500ms base backoff, 300000ms call timeout")
		const unconfiguredDiagnosticText = formatOwnerProviderDiagnostic(buildOwnerProviderDiagnostic(emptySelection))
		const unconfiguredGuidanceVisible =
			unconfiguredDiagnosticText.includes("Sign in to Gemini CLI once") &&
			unconfiguredDiagnosticText.includes("OPENAI_API_KEY") &&
			unconfiguredDiagnosticText.includes("queenshift doctor") &&
			unconfiguredDiagnosticText.includes("Ready: yes") &&
			unconfiguredDiagnosticText.includes("queenshift owner:guided:demo") &&
			unconfiguredDiagnosticText.includes(
				"Expected retry policy once ready: 1 retry attempt(s), 1500ms base backoff, 300000ms call timeout",
			)

		details.push(
			`fallback=${geminiSelection.provider ?? "none"}/${geminiSelection.authMode ?? "none"}/${geminiSelection.transport}`,
			`cliPinned=${cliPinnedSelection.transport}/${cliPinnedSelection.envOverrides["GEMINI_CLI_COMMAND"] ?? "missing"}`,
			`empty=${emptySelection.provider ?? "none"}/${emptySelection.ready ? "ready" : "not-ready"}`,
		)

		return {
			geminiOauthPreferred,
			geminiCliFallbackVisible,
			geminiCliCommandPinned,
			unconfiguredFailsClosed,
			retryPolicySurfaced,
			statusTextMakesProviderVisible,
			diagnosticGuidanceVisible,
			unconfiguredGuidanceVisible,
			details,
		}
	} finally {
		if (fs.existsSync(oauthDir)) fs.rmSync(oauthDir, { recursive: true, force: true })
	}
}

export function formatOwnerProviderDefaultsHarnessResult(result: OwnerProviderDefaultsHarnessResult): string {
	return [
		`Gemini OAuth preferred: ${result.geminiOauthPreferred ? "PASS" : "FAIL"}`,
		`Gemini CLI fallback stays visible: ${result.geminiCliFallbackVisible ? "PASS" : "FAIL"}`,
		`Gemini CLI command is pinned when resolved: ${result.geminiCliCommandPinned ? "PASS" : "FAIL"}`,
		`Unconfigured provider fails closed: ${result.unconfiguredFailsClosed ? "PASS" : "FAIL"}`,
		`Retry policy surfaced: ${result.retryPolicySurfaced ? "PASS" : "FAIL"}`,
		`Status text makes provider visible: ${result.statusTextMakesProviderVisible ? "PASS" : "FAIL"}`,
		`Diagnostic guidance visible: ${result.diagnosticGuidanceVisible ? "PASS" : "FAIL"}`,
		`Unconfigured guidance visible: ${result.unconfiguredGuidanceVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerProviderDefaultsHarness()
	console.log(formatOwnerProviderDefaultsHarnessResult(result))
	process.exit(
		result.geminiOauthPreferred &&
			result.geminiCliFallbackVisible &&
			result.geminiCliCommandPinned &&
			result.unconfiguredFailsClosed &&
			result.retryPolicySurfaced &&
			result.statusTextMakesProviderVisible &&
			result.diagnosticGuidanceVisible &&
			result.unconfiguredGuidanceVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:provider-defaults] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
