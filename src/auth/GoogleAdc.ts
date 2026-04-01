import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Env = Record<string, string | undefined>

type AuthorizedUserAdc = {
	type: "authorized_user"
	client_id: string
	client_secret: string
	refresh_token: string
	quota_project_id?: string
}

type TokenResponse = {
	access_token?: unknown
	expires_in?: unknown
	token_type?: unknown
	error?: unknown
	error_description?: unknown
}

function expandHomePath(rawPath: string): string {
	const trimmed = rawPath.trim()
	if (!trimmed) return ""
	if (trimmed === "~") return os.homedir()
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2))
	}
	return path.resolve(trimmed)
}

function readJsonFile(filePath: string): unknown {
	const text = fs.readFileSync(filePath, "utf8")
	return JSON.parse(text) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function requireStringField(obj: Record<string, unknown>, field: string): string {
	const value = obj[field]
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`ADC credentials missing required string field: ${field}`)
	}
	return value
}

function parseAuthorizedUserAdc(json: unknown): AuthorizedUserAdc {
	const obj = asRecord(json)
	if (!obj) throw new Error("ADC credentials JSON must be an object")
	const type = requireStringField(obj, "type")
	if (type !== "authorized_user") {
		throw new Error(
			`Unsupported ADC credentials type: ${type}. ` +
				`Expected "authorized_user" (from \`gcloud auth application-default login\`).`,
		)
	}
	const quota_project_id = typeof obj["quota_project_id"] === "string" ? obj["quota_project_id"] : undefined
	return {
		type: "authorized_user",
		client_id: requireStringField(obj, "client_id"),
		client_secret: requireStringField(obj, "client_secret"),
		refresh_token: requireStringField(obj, "refresh_token"),
		quota_project_id,
	}
}

function defaultAdcPath(env: Env): string {
	// Mirrors google-auth-library defaults at a high level, without adding deps.
	const home = os.homedir()

	if (process.platform === "win32") {
		const appData = env["APPDATA"] || path.join(home, "AppData", "Roaming")
		return path.join(appData, "gcloud", "application_default_credentials.json")
	}

	const xdgConfig = env["XDG_CONFIG_HOME"] || path.join(home, ".config")
	return path.join(xdgConfig, "gcloud", "application_default_credentials.json")
}

export type AdcAccessTokenProvider = {
	credentialPath: string
	quotaProjectId?: string
	getAccessToken: () => Promise<string>
}

async function refreshAccessToken(creds: AuthorizedUserAdc): Promise<{ token: string; expiresInSec: number }> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: creds.client_id,
		client_secret: creds.client_secret,
		refresh_token: creds.refresh_token,
	})

	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	})

	const rawText = await res.text().catch(() => "")
	let data: TokenResponse = {}
	try {
		data = JSON.parse(rawText) as TokenResponse
	} catch {
		// ignore
	}

	if (!res.ok) {
		const err = typeof data.error === "string" ? data.error : ""
		const desc = typeof data.error_description === "string" ? data.error_description : ""
		const details = [err, desc].filter(Boolean).join(": ") || rawText.slice(0, 400)
		throw new Error(`ADC token refresh failed (HTTP ${res.status}): ${details || res.statusText}`)
	}

	const accessToken = typeof data.access_token === "string" ? data.access_token : ""
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in)

	if (!accessToken) throw new Error("ADC token refresh response missing access_token")
	if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("ADC token refresh response missing expires_in")

	return { token: accessToken, expiresInSec: Math.floor(expiresIn) }
}

export function tryCreateAdcAccessTokenProvider(
	env: Env,
	options: { required: true },
): AdcAccessTokenProvider
export function tryCreateAdcAccessTokenProvider(
	env: Env,
	options?: { required?: false | undefined },
): AdcAccessTokenProvider | null
export function tryCreateAdcAccessTokenProvider(
	env: Env,
	options: { required?: boolean } = {},
): AdcAccessTokenProvider | null {
	const required = Boolean(options.required)
	const explicitPath = (env["SWARM_GEMINI_ADC_PATH"] ?? env["GOOGLE_APPLICATION_CREDENTIALS"] ?? "").trim()
	const resolvedPath = expandHomePath(explicitPath || defaultAdcPath(env))

	if (!resolvedPath || !fs.existsSync(resolvedPath)) {
		if (!required) return null
		throw new Error(
			`ADC credentials not found at ${resolvedPath}.\n` +
				`Run \`gcloud auth application-default login\` or set SWARM_GEMINI_ADC_PATH / GOOGLE_APPLICATION_CREDENTIALS.`,
		)
	}

	const creds = parseAuthorizedUserAdc(readJsonFile(resolvedPath))

	let cachedToken = ""
	let cachedExpiresAtMs = 0
	let inFlight: Promise<string> | null = null

	const getAccessToken = async (): Promise<string> => {
		const now = Date.now()
		if (cachedToken && now < cachedExpiresAtMs - 60_000) return cachedToken
		if (inFlight) return inFlight

		inFlight = (async () => {
			const refreshed = await refreshAccessToken(creds)
			cachedToken = refreshed.token
			cachedExpiresAtMs = Date.now() + refreshed.expiresInSec * 1000
			return cachedToken
		})()

		try {
			return await inFlight
		} finally {
			inFlight = null
		}
	}

	return {
		credentialPath: resolvedPath,
		quotaProjectId: creds.quota_project_id,
		getAccessToken,
	}
}
