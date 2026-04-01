import type { IModelClient } from "./IModelClient"
import { ModelClient } from "./ModelClient"
import { ResilientModelClient } from "./ResilientModelClient"
import { tryCreateAdcAccessTokenProvider } from "../auth/GoogleAdc"
import { GeminiCliModelClient } from "./GeminiCliModelClient"
import { tryCreateGeminiCliOauthAccessTokenProvider } from "../auth/GeminiCliOAuth"
import { resolveRuntimeConfig } from "../run/RuntimeConfig"
import { resolveGeminiCliCommand } from "./ProviderCommandResolution"

type Provider = "openai" | "gemini"

function resolveProvider(env: Record<string, string | undefined>): Provider {
	const explicit = (env["SWARM_PROVIDER"] ?? "").trim().toLowerCase()
	if (explicit === "openai" || explicit === "gemini") return explicit
	const geminiAuth = (env["SWARM_GEMINI_AUTH"] ?? "").trim().toLowerCase()
	if (geminiAuth === "adc" || geminiAuth === "access_token" || geminiAuth === "api_key" || geminiAuth === "cli")
		return "gemini"
	if (env["GEMINI_API_KEY"] || env["GEMINI_ACCESS_TOKEN"]) return "gemini"
	return "openai"
}

export function createLiveModelClient(env: Record<string, string | undefined>): IModelClient {
	const provider = resolveProvider(env)
	const runtimeConfig = resolveRuntimeConfig(env)

	const wrap = (client: IModelClient): IModelClient =>
		new ResilientModelClient(client, {
			maxRetries: runtimeConfig.providerMaxRetries,
			baseDelayMs: runtimeConfig.providerRetryBackoffMs,
		})

	if (provider === "gemini") {
		const authMode = (env["SWARM_GEMINI_AUTH"] ?? "auto").trim().toLowerCase()
		const apiKey = env["GEMINI_API_KEY"] ?? ""
		const accessToken = env["GEMINI_ACCESS_TOKEN"] ?? ""
		const model = env["SWARM_MODEL"] ?? "gemini-2.5-flash"
		const baseUrl = env["SWARM_BASE_URL"] ?? "https://generativelanguage.googleapis.com/v1beta/openai"

		const userProjectEnv =
			env["GEMINI_USER_PROJECT"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? env["GCLOUD_PROJECT"] ?? env["GCP_PROJECT"]

		const headers: Record<string, string> = {}
		const requireUserProject = (quotaProjectId?: string): string => {
			const userProject = userProjectEnv ?? quotaProjectId ?? ""
			if (!userProject) {
				throw new Error(
					"Gemini OAuth requires a user project for billing/quota.\n" +
						"Set GEMINI_USER_PROJECT (or GOOGLE_CLOUD_PROJECT) to your GCP project id.",
				)
			}
			return userProject
		}

		// Explicit auth mode override.
		if (authMode === "api_key") {
			if (!apiKey) throw new Error("Missing GEMINI_API_KEY for SWARM_PROVIDER=gemini (SWARM_GEMINI_AUTH=api_key)")
			headers["x-goog-api-key"] = apiKey
			return wrap(new ModelClient("", model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}
		if (authMode === "access_token") {
			if (!accessToken) {
				throw new Error(
					"Missing GEMINI_ACCESS_TOKEN for SWARM_PROVIDER=gemini (SWARM_GEMINI_AUTH=access_token)",
				)
			}
			headers["x-goog-user-project"] = requireUserProject()
			return wrap(new ModelClient(accessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}
		if (authMode === "adc") {
			const adc = tryCreateAdcAccessTokenProvider(env, { required: true })
			headers["x-goog-user-project"] = requireUserProject(adc.quotaProjectId)
			return wrap(new ModelClient(adc.getAccessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}
		if (authMode === "cli") {
			const { resolved } = resolveGeminiCliCommand(env)

			// Prefer the CLI binary if present; otherwise use the OAuth creds file directly (no API key required).
			if (resolved) {
				return wrap(
					new GeminiCliModelClient({
						model,
						oauthPath: env["GEMINI_CLI_OAUTH_PATH"],
						command: resolved,
						timeoutMs: runtimeConfig.providerCallTimeoutMs,
					}),
				)
			}

			const oauth = tryCreateGeminiCliOauthAccessTokenProvider(env, { required: true })
			if (userProjectEnv) headers["x-goog-user-project"] = userProjectEnv
			return wrap(new ModelClient(oauth.getAccessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}

		// Auto: prefer API key, then access token, then ADC.
		if (apiKey) {
			headers["x-goog-api-key"] = apiKey
			return wrap(new ModelClient("", model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}
		if (accessToken) {
			headers["x-goog-user-project"] = requireUserProject()
			return wrap(new ModelClient(accessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}

		const adc = tryCreateAdcAccessTokenProvider(env)
		if (adc) {
			headers["x-goog-user-project"] = requireUserProject(adc.quotaProjectId)
			return wrap(new ModelClient(adc.getAccessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}

		const oauth = tryCreateGeminiCliOauthAccessTokenProvider(env)
		if (oauth) {
			if (userProjectEnv) headers["x-goog-user-project"] = userProjectEnv
			return wrap(new ModelClient(oauth.getAccessToken, model, { baseUrl, headers, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
		}

		throw new Error(
			"Missing Gemini credentials.\n" +
				"- Recommended: set GEMINI_API_KEY\n" +
				"- OAuth: set GEMINI_ACCESS_TOKEN + GEMINI_USER_PROJECT\n" +
				"- ADC: run `gcloud auth application-default login` and set GEMINI_USER_PROJECT (or SWARM_GEMINI_AUTH=adc)\n" +
				"- Gemini CLI: set SWARM_GEMINI_AUTH=cli (uses ~/.gemini/oauth_creds.json; CLI binary optional)",
		)
	}

	const apiKey = env["OPENAI_API_KEY"] ?? ""
	if (!apiKey) throw new Error("Missing OPENAI_API_KEY for SWARM_PROVIDER=openai")
	const model = env["SWARM_MODEL"] ?? "gpt-4o-mini"
	const baseUrl = env["SWARM_BASE_URL"] ?? "https://api.openai.com/v1"
	return wrap(new ModelClient(apiKey, model, { baseUrl, timeoutMs: runtimeConfig.providerCallTimeoutMs }))
}
