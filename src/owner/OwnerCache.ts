import fs from "node:fs"
import path from "node:path"

import { getMemoryLayerBoundary, type MemoryLayerBoundary } from "../planning/MemoryLayers"
import { DEFAULT_GUIDED_TASK_TEMPLATE_ID, type GuidedTaskTemplateId } from "../shell/GuidedTaskTemplates"
import { ensureCanonicalOwnerGuidedDemoManifest } from "./OwnerProfileManifest"

export type OwnerComposerMode = "guided" | "free_form"

export type OwnerCacheRecord = {
	version: 1
	updatedAt: string
	memoryBoundary: MemoryLayerBoundary
	compactionPolicy: {
		mode: "single_record_replace"
		retainedRecordCount: 1
	}
	defaults: {
		workspace: string | null
		provider: string | null
		authMode: string | null
		model: string | null
		composerMode: OwnerComposerMode | null
		guidedTemplateId: GuidedTaskTemplateId | null
		starterSurface: string | null
	}
	profile: {
		profileId: string | null
		manifestHash: string | null
	}
}

export type OwnerCacheDriftResult = {
	driftDetected: boolean
	reasons: string[]
}

export type OwnerCacheDefaultsResolution = {
	workspace: string
	composerMode: OwnerComposerMode
	guidedTemplateId: GuidedTaskTemplateId
	cacheStatusText: string
	driftDetected: boolean
	driftReasons: string[]
}

export type OwnerCacheResetResult = {
	path: string
	existed: boolean
	removed: boolean
}

export type OwnerCacheRememberInput = {
	workspace?: string | null
	provider?: string | null
	authMode?: string | null
	model?: string | null
	composerMode?: OwnerComposerMode | null
	guidedTemplateId?: GuidedTaskTemplateId | null
	starterSurface?: string | null
	profileId?: string | null
	manifestHash?: string | null
}

const OWNER_CACHE_RELATIVE_PATH = path.join("owner_profiles", "owner-cache.local.json")

function normalizeString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function normalizeGuidedTemplateId(value: unknown): GuidedTaskTemplateId | null {
	const normalized = normalizeString(value)
	return normalized ? (normalized as GuidedTaskTemplateId) : null
}

function buildEmptyOwnerCache(): OwnerCacheRecord {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		memoryBoundary: getMemoryLayerBoundary("owner_cache_defaults"),
		compactionPolicy: {
			mode: "single_record_replace",
			retainedRecordCount: 1,
		},
		defaults: {
			workspace: null,
			provider: null,
			authMode: null,
			model: null,
			composerMode: null,
			guidedTemplateId: null,
			starterSurface: null,
		},
		profile: {
			profileId: null,
			manifestHash: null,
		},
	}
}

function normalizeCacheRecord(parsed: unknown): OwnerCacheRecord | null {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
	const record = parsed as Record<string, unknown>
	const defaultsRaw =
		record["defaults"] && typeof record["defaults"] === "object" && !Array.isArray(record["defaults"])
			? (record["defaults"] as Record<string, unknown>)
			: {}
	const profileRaw =
		record["profile"] && typeof record["profile"] === "object" && !Array.isArray(record["profile"])
			? (record["profile"] as Record<string, unknown>)
			: {}
	const composerMode = normalizeString(defaultsRaw["composerMode"])
	return {
		version: 1,
		updatedAt: normalizeString(record["updatedAt"]) ?? new Date(0).toISOString(),
		memoryBoundary: getMemoryLayerBoundary("owner_cache_defaults"),
		compactionPolicy: {
			mode: "single_record_replace",
			retainedRecordCount: 1,
		},
		defaults: {
			workspace: normalizeString(defaultsRaw["workspace"]),
			provider: normalizeString(defaultsRaw["provider"]),
			authMode: normalizeString(defaultsRaw["authMode"]),
			model: normalizeString(defaultsRaw["model"]),
			composerMode: composerMode === "guided" || composerMode === "free_form" ? composerMode : null,
			guidedTemplateId: normalizeGuidedTemplateId(defaultsRaw["guidedTemplateId"]),
			starterSurface: normalizeString(defaultsRaw["starterSurface"]),
		},
		profile: {
			profileId: normalizeString(profileRaw["profileId"]),
			manifestHash: normalizeString(profileRaw["manifestHash"]),
		},
	}
}

function writeOwnerCacheRecord(cachePath: string, record: OwnerCacheRecord): void {
	fs.mkdirSync(path.dirname(cachePath), { recursive: true })
	fs.writeFileSync(cachePath, `${JSON.stringify(record, null, 2)}\n`, "utf8")
}

function summarizeDefaults(record: OwnerCacheRecord | null): string {
	if (!record) return "Remembered defaults: none yet."

	const parts: string[] = []
	if (record.defaults.workspace) parts.push(`workspace=${record.defaults.workspace}`)
	if (record.defaults.provider) {
		const providerLabel = record.defaults.authMode
			? `${record.defaults.provider} (${record.defaults.authMode})`
			: record.defaults.provider
		parts.push(`provider=${providerLabel}`)
	}
	if (record.defaults.composerMode) {
		const modeLabel =
			record.defaults.composerMode === "guided" && record.defaults.guidedTemplateId
				? `${record.defaults.composerMode}/${record.defaults.guidedTemplateId}`
				: record.defaults.composerMode
		parts.push(`starter=${modeLabel}`)
	}
	if (record.profile.profileId) parts.push(`profile=${record.profile.profileId}`)
	return `Remembered defaults: ${parts.join(" | ") || "none yet."}`
}

function summarizeBoundary(record: OwnerCacheRecord | null): string {
	const boundary = record?.memoryBoundary ?? getMemoryLayerBoundary("owner_cache_defaults")
	return `Layer boundary: ${boundary.id} | ${boundary.purpose} Retention=${boundary.retentionRule}`
}

function summarizeCompaction(record: OwnerCacheRecord | null): string {
	const policy = record?.compactionPolicy ?? { mode: "single_record_replace" as const, retainedRecordCount: 1 as const }
	return `Compaction policy: ${policy.mode} retainedRecords=${policy.retainedRecordCount}`
}

export function resolveOwnerCachePath(rootDir: string): string {
	return path.join(rootDir, OWNER_CACHE_RELATIVE_PATH)
}

export function readOwnerCache(rootDir: string): OwnerCacheRecord | null {
	const cachePath = resolveOwnerCachePath(rootDir)
	if (!fs.existsSync(cachePath)) return null
	try {
		return normalizeCacheRecord(JSON.parse(fs.readFileSync(cachePath, "utf8")) as unknown)
	} catch {
		return null
	}
}

export function rememberOwnerCache(rootDir: string, input: OwnerCacheRememberInput): OwnerCacheRecord {
	const cachePath = resolveOwnerCachePath(rootDir)
	const current = readOwnerCache(rootDir) ?? buildEmptyOwnerCache()
	const next: OwnerCacheRecord = {
		version: 1,
		updatedAt: new Date().toISOString(),
		memoryBoundary: getMemoryLayerBoundary("owner_cache_defaults"),
		compactionPolicy: {
			mode: "single_record_replace",
			retainedRecordCount: 1,
		},
		defaults: {
			workspace:
				input.workspace !== undefined
					? normalizeString(input.workspace)
					: current.defaults.workspace,
			provider:
				input.provider !== undefined
					? normalizeString(input.provider)
					: current.defaults.provider,
			authMode:
				input.authMode !== undefined
					? normalizeString(input.authMode)
					: current.defaults.authMode,
			model:
				input.model !== undefined
					? normalizeString(input.model)
					: current.defaults.model,
			composerMode:
				input.composerMode !== undefined
					? input.composerMode
					: current.defaults.composerMode,
			guidedTemplateId:
				input.guidedTemplateId !== undefined
					? input.guidedTemplateId
					: current.defaults.guidedTemplateId,
			starterSurface:
				input.starterSurface !== undefined
					? normalizeString(input.starterSurface)
					: current.defaults.starterSurface,
		},
		profile: {
			profileId:
				input.profileId !== undefined
					? normalizeString(input.profileId)
					: current.profile.profileId,
			manifestHash:
				input.manifestHash !== undefined
					? normalizeString(input.manifestHash)
					: current.profile.manifestHash,
		},
	}
	writeOwnerCacheRecord(cachePath, next)
	return next
}

export function resetOwnerCache(rootDir: string): OwnerCacheResetResult {
	const cachePath = resolveOwnerCachePath(rootDir)
	const existed = fs.existsSync(cachePath)
	if (existed) fs.rmSync(cachePath, { force: true })
	return {
		path: cachePath,
		existed,
		removed: !fs.existsSync(cachePath),
	}
}

export function evaluateOwnerCacheDrift(rootDir: string, cache: OwnerCacheRecord | null = readOwnerCache(rootDir)): OwnerCacheDriftResult {
	const reasons: string[] = []
	if (!cache) return { driftDetected: false, reasons }

	const manifestCheck = ensureCanonicalOwnerGuidedDemoManifest(rootDir)
	const expected = manifestCheck.manifest

	if (cache.profile.profileId && cache.profile.profileId !== expected.profileId) {
		reasons.push(`Cached profile id ${cache.profile.profileId} no longer matches canonical ${expected.profileId}.`)
	}
	if (cache.profile.manifestHash && cache.profile.manifestHash !== expected.manifestHash) {
		reasons.push("Cached manifest hash no longer matches the frozen canonical manifest.")
	}
	if (manifestCheck.driftDetected) {
		reasons.push(...manifestCheck.driftReasons)
	}

	return {
		driftDetected: reasons.length > 0,
		reasons,
	}
}

function workspaceLooksSelectable(workspace: string | null): boolean {
	if (!workspace) return false
	try {
		if (!fs.existsSync(workspace)) return false
		if (!fs.statSync(workspace).isDirectory()) return false
		const gitPath = path.join(workspace, ".git")
		return fs.existsSync(gitPath)
	} catch {
		return false
	}
}

async function firstSafeWorkspace(candidatePaths: string[]): Promise<string> {
	for (const candidate of candidatePaths) {
		const resolved = normalizeString(candidate)
		if (!resolved) continue
		const absolute = path.resolve(resolved)
		if (workspaceLooksSelectable(absolute)) return absolute
	}
	return ""
}

export async function resolveOwnerShellCachedDefaults(
	rootDir: string,
	candidatePaths: string[],
): Promise<OwnerCacheDefaultsResolution> {
	const cache = readOwnerCache(rootDir)
	const drift = evaluateOwnerCacheDrift(rootDir, cache)
	const defaultComposerMode = cache?.defaults.composerMode ?? "guided"
	const defaultTemplate = cache?.defaults.guidedTemplateId ?? DEFAULT_GUIDED_TASK_TEMPLATE_ID

	const workspace =
		!drift.driftDetected && workspaceLooksSelectable(cache?.defaults.workspace ?? null)
			? path.resolve(cache?.defaults.workspace ?? "")
			: await firstSafeWorkspace(candidatePaths)

	const cacheStatusText = drift.driftDetected
		? [
				summarizeDefaults(cache),
				summarizeBoundary(cache),
				summarizeCompaction(cache),
				`Cache drift: ${drift.reasons.join(" | ")}`,
				"Reset the remembered defaults with npm.cmd run owner:cache:reset or relaunch the frozen owner surface to re-freeze them.",
		  ].join("\n")
		: [summarizeDefaults(cache), summarizeBoundary(cache), summarizeCompaction(cache)].join("\n")

	return {
		workspace,
		composerMode: defaultComposerMode,
		guidedTemplateId: defaultTemplate,
		cacheStatusText,
		driftDetected: drift.driftDetected,
		driftReasons: drift.reasons,
	}
}

export function formatOwnerCacheStatus(rootDir: string): string {
	const cache = readOwnerCache(rootDir)
	const drift = evaluateOwnerCacheDrift(rootDir, cache)
	return [
		summarizeDefaults(cache),
		summarizeBoundary(cache),
		summarizeCompaction(cache),
		...(drift.driftDetected ? [`Cache drift: ${drift.reasons.join(" | ")}`] : ["Cache drift: none detected."]),
		`Cache file: ${resolveOwnerCachePath(rootDir)}`,
	].join("\n")
}

export function formatOwnerCacheResetResult(result: OwnerCacheResetResult): string {
	return [
		`Owner cache reset: ${result.removed ? "PASS" : "FAIL"}`,
		`Cache file: ${result.path}`,
		`Previously existed: ${result.existed ? "yes" : "no"}`,
	].join("\n")
}
