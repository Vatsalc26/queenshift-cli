import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveGeminiCliCommand } from "../model/ProviderCommandResolution"
import { resolveRuntimeConfig } from "../run/RuntimeConfig"

export type OwnerProvider = "gemini" | "openai"
export type OwnerProviderTransport =
	| "none"
	| "openai_http"
	| "gemini_api_http"
	| "gemini_access_token_http"
	| "gemini_adc_http"
	| "gemini_cli_subprocess"
	| "gemini_cli_oauth_http"

export type OwnerProviderSource =
	| "explicit_provider"
	| "detected_gemini_cli_oauth"
	| "detected_gemini_credentials"
	| "detected_openai_api_key"
	| "unconfigured"

export type OwnerProviderSelection = {
	provider: OwnerProvider | null
	model: string | null
	authMode: string | null
	source: OwnerProviderSource
	ready: boolean
	reason: string
	transport: OwnerProviderTransport
	transportNote: string
	envOverrides: Record<string, string>
}

export type OwnerProviderDiagnostic = {
	selection: OwnerProviderSelection
	nextSteps: string[]
}

export function expandHomePath(rawPath: string): string {
	const trimmed = rawPath.trim()
	if (!trimmed) return ""
	if (trimmed === "~") return os.homedir()
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2))
	}
	return path.resolve(trimmed)
}

function getUserProject(env: Record<string, string | undefined>): string {
	return (
		env["GEMINI_USER_PROJECT"] ??
		env["GOOGLE_CLOUD_PROJECT"] ??
		env["GCLOUD_PROJECT"] ??
		env["GCP_PROJECT"] ??
		""
	).trim()
}

export function detectGeminiCliOauthPath(env: Record<string, string | undefined>): string | null {
	const oauthPath = expandHomePath(env["GEMINI_CLI_OAUTH_PATH"] ?? "~/.gemini/oauth_creds.json")
	if (!oauthPath) return null
	return fs.existsSync(oauthPath) ? oauthPath : null
}

function defaultModelFor(provider: OwnerProvider): string {
	return provider === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini"
}

function buildSelection(
	provider: OwnerProvider | null,
	authMode: string | null,
	source: OwnerProviderSource,
	ready: boolean,
	reason: string,
	env: Record<string, string | undefined>,
	options: { oauthPath?: string | null } = {},
): OwnerProviderSelection {
	const envOverrides: Record<string, string> = {}
	const runtimeConfig = resolveRuntimeConfig(env)
	if (provider) {
		envOverrides["SWARM_PROVIDER"] = provider
		envOverrides["SWARM_MODEL"] = (env["SWARM_MODEL"] ?? "").trim() || defaultModelFor(provider)
		envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] = String(runtimeConfig.providerCallTimeoutMs)
		envOverrides["SWARM_PROVIDER_MAX_RETRIES"] = String(runtimeConfig.providerMaxRetries)
		envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] = String(runtimeConfig.providerRetryBackoffMs)
	}
	if (provider === "gemini" && authMode) {
		envOverrides["SWARM_GEMINI_AUTH"] = authMode
	}

	const transport = describeOwnerProviderTransport(provider, authMode, ready, env, options.oauthPath ?? null)
	if (provider === "gemini" && authMode === "cli" && options.oauthPath) {
		envOverrides["GEMINI_CLI_OAUTH_PATH"] = options.oauthPath
	}
	if (transport.resolvedCliCommand) {
		envOverrides["GEMINI_CLI_COMMAND"] = transport.resolvedCliCommand
	}

	return {
		provider,
		model: provider ? envOverrides["SWARM_MODEL"] ?? defaultModelFor(provider) : null,
		authMode,
		source,
		ready,
		reason,
		transport: transport.transport,
		transportNote: transport.note,
		envOverrides,
	}
}

function formatRetryPolicy(selection: OwnerProviderSelection): string {
	const retries = selection.envOverrides["SWARM_PROVIDER_MAX_RETRIES"] ?? "1"
	const backoffMs = selection.envOverrides["SWARM_PROVIDER_RETRY_BACKOFF_MS"] ?? "1500"
	const timeoutMs = selection.envOverrides["SWARM_PROVIDER_CALL_TIMEOUT_MS"] ?? "300000"
	return `${retries} retry attempt(s), ${backoffMs}ms base backoff, ${timeoutMs}ms call timeout`
}

function resolveGeminiAuthMode(env: Record<string, string | undefined>): {
	ready: boolean
	authMode: string | null
	source: OwnerProviderSource
	reason: string
	oauthPath: string | null
} {
	const explicitAuthMode = (env["SWARM_GEMINI_AUTH"] ?? "").trim().toLowerCase()
	const oauthPath = detectGeminiCliOauthPath(env)
	const hasApiKey = Boolean((env["GEMINI_API_KEY"] ?? "").trim())
	const hasAccessToken = Boolean((env["GEMINI_ACCESS_TOKEN"] ?? "").trim())
	const userProject = getUserProject(env)

	if (explicitAuthMode === "api_key") {
		return {
			ready: hasApiKey,
			authMode: "api_key",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: hasApiKey
				? "Using explicit Gemini API key configuration."
				: "SWARM_GEMINI_AUTH=api_key was requested, but GEMINI_API_KEY is missing.",
		}
	}

	if (explicitAuthMode === "access_token") {
		return {
			ready: hasAccessToken && Boolean(userProject),
			authMode: "access_token",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason:
				hasAccessToken && userProject
					? "Using explicit Gemini access-token configuration."
					: "SWARM_GEMINI_AUTH=access_token requires GEMINI_ACCESS_TOKEN plus GEMINI_USER_PROJECT (or GOOGLE_CLOUD_PROJECT).",
		}
	}

	if (explicitAuthMode === "adc") {
		return {
			ready: Boolean(userProject),
			authMode: "adc",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: userProject
				? "Using explicit Gemini ADC configuration."
				: "SWARM_GEMINI_AUTH=adc requires GEMINI_USER_PROJECT (or GOOGLE_CLOUD_PROJECT).",
		}
	}

	if (explicitAuthMode === "cli") {
		return {
			ready: Boolean(oauthPath),
			authMode: "cli",
			source: oauthPath ? "detected_gemini_cli_oauth" : "detected_gemini_credentials",
			oauthPath,
			reason: oauthPath
				? `Detected Gemini CLI OAuth credentials at ${oauthPath}.`
				: "SWARM_GEMINI_AUTH=cli was requested, but Gemini CLI OAuth credentials were not found.",
		}
	}

	if (oauthPath) {
		return {
			ready: true,
			authMode: "cli",
			source: "detected_gemini_cli_oauth",
			oauthPath,
			reason: `Detected local Gemini CLI OAuth credentials at ${oauthPath}.`,
		}
	}

	if (hasApiKey) {
		return {
			ready: true,
			authMode: "api_key",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: "Detected Gemini API key credentials.",
		}
	}

	if (hasAccessToken && userProject) {
		return {
			ready: true,
			authMode: "access_token",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: "Detected Gemini access token plus user project.",
		}
	}

	if (hasAccessToken) {
		return {
			ready: false,
			authMode: "access_token",
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: "Detected GEMINI_ACCESS_TOKEN, but GEMINI_USER_PROJECT (or GOOGLE_CLOUD_PROJECT) is missing.",
		}
	}

	if (explicitAuthMode) {
		return {
			ready: false,
			authMode: explicitAuthMode,
			source: "detected_gemini_credentials",
			oauthPath: null,
			reason: `Unsupported SWARM_GEMINI_AUTH value: ${explicitAuthMode}.`,
		}
	}

	return {
		ready: false,
		authMode: null,
		source: "unconfigured",
		oauthPath: null,
		reason: "No supported Gemini credentials were detected.",
	}
}

function describeOwnerProviderTransport(
	provider: OwnerProvider | null,
	authMode: string | null,
	ready: boolean,
	env: Record<string, string | undefined>,
	oauthPath: string | null,
): {
	transport: OwnerProviderTransport
	note: string
	resolvedCliCommand: string | null
} {
	if (!provider || !ready) {
		if (provider === "gemini" && authMode === "cli") {
			return {
				transport: "none",
				note: "Gemini CLI OAuth is selected, but credentials are not ready yet.",
				resolvedCliCommand: null,
			}
		}

		return {
			transport: "none",
			note: "No live provider transport is ready yet.",
			resolvedCliCommand: null,
		}
	}

	if (provider === "openai") {
		return {
			transport: "openai_http",
			note: "Using direct HTTPS calls against the OpenAI-compatible chat completions API.",
			resolvedCliCommand: null,
		}
	}

	if (authMode === "api_key") {
		return {
			transport: "gemini_api_http",
			note: "Using direct HTTPS calls against the Gemini OpenAI-compatible API with GEMINI_API_KEY.",
			resolvedCliCommand: null,
		}
	}

	if (authMode === "access_token") {
		return {
			transport: "gemini_access_token_http",
			note: "Using direct HTTPS calls against the Gemini OpenAI-compatible API with a bearer token.",
			resolvedCliCommand: null,
		}
	}

	if (authMode === "adc") {
		return {
			transport: "gemini_adc_http",
			note: "Using direct HTTPS calls against the Gemini OpenAI-compatible API with ADC tokens.",
			resolvedCliCommand: null,
		}
	}

	if (authMode === "cli") {
		const cli = resolveGeminiCliCommand(env)
		if (cli.resolved) {
			return {
				transport: "gemini_cli_subprocess",
				note: `Using Gemini CLI subprocess transport via ${cli.resolved}.`,
				resolvedCliCommand: cli.resolved,
			}
		}

		return {
			transport: "gemini_cli_oauth_http",
			note:
				oauthPath
					? "Gemini CLI OAuth credentials were detected, but no Gemini CLI executable was resolved; live runs will fall back to direct HTTPS transport."
					: "Gemini CLI transport could not be resolved because OAuth credentials were not found.",
			resolvedCliCommand: null,
		}
	}

	return {
		transport: "none",
		note: "No live provider transport is ready yet.",
		resolvedCliCommand: null,
	}
}

export function resolveOwnerProviderSelection(
	env: Record<string, string | undefined> = process.env,
): OwnerProviderSelection {
	const explicitProvider = (env["SWARM_PROVIDER"] ?? "").trim().toLowerCase()
	const hasOpenAiKey = Boolean((env["OPENAI_API_KEY"] ?? "").trim())
	const gemini = resolveGeminiAuthMode(env)

	if (explicitProvider === "gemini") {
		return buildSelection("gemini", gemini.authMode ?? "auto", "explicit_provider", gemini.ready, gemini.reason, env, {
			oauthPath: gemini.oauthPath,
		})
	}

	if (explicitProvider === "openai") {
		return buildSelection(
			"openai",
			null,
			"explicit_provider",
			hasOpenAiKey,
			hasOpenAiKey ? "Using explicit OpenAI configuration." : "SWARM_PROVIDER=openai was requested, but OPENAI_API_KEY is missing.",
			env,
		)
	}

	if (gemini.ready) {
		return buildSelection("gemini", gemini.authMode, gemini.source, true, gemini.reason, env, {
			oauthPath: gemini.oauthPath,
		})
	}

	if (hasOpenAiKey) {
		return buildSelection("openai", null, "detected_openai_api_key", true, "Detected OPENAI_API_KEY in the current environment.", env)
	}

	return buildSelection(
		null,
		null,
		"unconfigured",
		false,
		"No supported live provider is configured. Sign in to Gemini CLI once or set explicit provider credentials before launching a live run.",
		env,
	)
}

export function formatOwnerProviderSelection(selection: OwnerProviderSelection): string {
	if (!selection.provider) {
		return `Provider: not ready\nReason: ${selection.reason}`
	}

	const authSuffix = selection.provider === "gemini" && selection.authMode ? ` (${selection.authMode})` : ""
	return [
		`Provider: ${selection.provider}${authSuffix}`,
		`Model: ${selection.model ?? defaultModelFor(selection.provider)}`,
		`Source: ${selection.source}`,
		`Transport: ${selection.transport}`,
		`Retry policy: ${formatRetryPolicy(selection)}`,
		`Ready: ${selection.ready ? "yes" : "no"}`,
		`Transport note: ${selection.transportNote}`,
		`Reason: ${selection.reason}`,
	].join("\n")
}

export function buildOwnerProviderDiagnostic(selection: OwnerProviderSelection): OwnerProviderDiagnostic {
	if (!selection.provider || !selection.ready) {
		return {
			selection,
			nextSteps: [
				"Fastest setup: sign in to Gemini CLI once, or set `SWARM_PROVIDER=openai` plus `OPENAI_API_KEY`.",
				"If you prefer Gemini environment credentials, set `SWARM_PROVIDER=gemini`, choose `SWARM_GEMINI_AUTH`, and add the matching credential variable.",
				"Run `queenshift doctor` again until the provider shows `Ready: yes`.",
				"Then start with `queenshift owner:guided:demo` before the first real repo.",
				`Expected retry policy once ready: ${formatRetryPolicy(selection)}`,
			],
		}
	}

	if (selection.provider === "gemini" && selection.authMode === "cli") {
		return {
			selection,
			nextSteps: [
				"Gemini CLI OAuth is ready for the supported live lane.",
				"Start with `queenshift owner:guided:demo` for the calmest first live pass.",
				"Then run `queenshift demo:run` before a real repo.",
				"Use `queenshift repo:onboard --workspace <repo>` before the first real target repo.",
				`Current retry policy: ${formatRetryPolicy(selection)}`,
			],
		}
	}

	return {
		selection,
		nextSteps: [
			"Provider transport is ready for live runs.",
			"Start with `queenshift owner:guided:demo` for the calmest first live pass.",
			"Then run `queenshift demo:run` before a real repo.",
			"Use `queenshift repo:onboard --workspace <repo>` before the first real target repo.",
			`Current retry policy: ${formatRetryPolicy(selection)}`,
		],
	}
}

export function formatOwnerProviderDiagnostic(diagnostic: OwnerProviderDiagnostic): string {
	return [
		formatOwnerProviderSelection(diagnostic.selection),
		"",
		"Next steps:",
		...diagnostic.nextSteps.map((step) => `- ${step}`),
	].join("\n")
}
