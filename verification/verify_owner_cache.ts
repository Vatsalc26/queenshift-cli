import fs from "node:fs"
import path from "node:path"

import {
	formatOwnerCacheResetResult,
	formatOwnerCacheStatus,
	rememberOwnerCache,
	resetOwnerCache,
	resolveOwnerCachePath,
	resolveOwnerShellCachedDefaults,
} from "../src/owner/OwnerCache"
import { ensureCanonicalOwnerGuidedDemoManifest } from "../src/owner/OwnerProfileManifest"

export type OwnerCacheHarnessResult = {
	cacheRemembersSafeDefaults: boolean
	cacheDriftFailsClosed: boolean
	resetClearsCache: boolean
	layerBoundaryVisible: boolean
	statusTextVisible: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function writeFile(filePath: string, contents: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, contents, "utf8")
}

async function createHarnessRoot(): Promise<{ rootDir: string; workspace: string; cleanup: () => void }> {
	const rootDir = path.join(resolveRootDir(), "verification", `.tmp-owner-cache-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	const workspace = path.join(rootDir, "workspace")

	writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({ name: "owner-cache-harness" }, null, 2)}\n`)
	writeFile(path.join(workspace, "package.json"), `${JSON.stringify({ name: "cache-workspace", private: true }, null, 2)}\n`)
	writeFile(path.join(workspace, "hello.ts"), "export const hello = 'world'\n")
	fs.mkdirSync(path.join(workspace, ".git"), { recursive: true })

	return {
		rootDir,
		workspace,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

export async function runOwnerCacheHarness(): Promise<OwnerCacheHarnessResult> {
	const harness = await createHarnessRoot()
	const details: string[] = []

	try {
		const manifest = ensureCanonicalOwnerGuidedDemoManifest(harness.rootDir).manifest
		rememberOwnerCache(harness.rootDir, {
			workspace: harness.workspace,
			provider: "gemini",
			authMode: "cli",
			model: "gemini-2.5-flash",
			composerMode: "guided",
			guidedTemplateId: "comment_file",
			starterSurface: "thin_shell_guided",
			profileId: manifest.profileId,
			manifestHash: manifest.manifestHash,
		})

		const resolved = await resolveOwnerShellCachedDefaults(harness.rootDir, [path.join(harness.rootDir, "fallback")])
		const cacheRemembersSafeDefaults =
			resolved.workspace === path.resolve(harness.workspace) &&
			resolved.composerMode === "guided" &&
			resolved.guidedTemplateId === "comment_file" &&
			!resolved.driftDetected

		rememberOwnerCache(harness.rootDir, {
			profileId: manifest.profileId,
			manifestHash: "stale-manifest-hash",
		})
		const drifted = await resolveOwnerShellCachedDefaults(harness.rootDir, [harness.workspace])
		const cacheDriftFailsClosed =
			drifted.driftDetected &&
			drifted.cacheStatusText.includes("Cache drift:") &&
			drifted.cacheStatusText.includes("owner:cache:reset")

		const statusText = formatOwnerCacheStatus(harness.rootDir)
		const statusTextVisible =
			statusText.includes("Remembered defaults:") &&
			statusText.includes("Cache file:") &&
			statusText.includes("Cache drift:")
		const layerBoundaryVisible =
			resolved.cacheStatusText.includes("Layer boundary: owner_cache_defaults") &&
			resolved.cacheStatusText.includes("Compaction policy: single_record_replace") &&
			statusText.includes("Layer boundary: owner_cache_defaults")

		const reset = resetOwnerCache(harness.rootDir)
		const resetText = formatOwnerCacheResetResult(reset)
		const resetClearsCache =
			reset.removed &&
			!fs.existsSync(resolveOwnerCachePath(harness.rootDir)) &&
			resetText.includes("Owner cache reset: PASS")

		details.push(`workspace=${resolved.workspace}`, `cachePath=${resolveOwnerCachePath(harness.rootDir)}`)

		return {
			cacheRemembersSafeDefaults,
			cacheDriftFailsClosed,
			resetClearsCache,
			layerBoundaryVisible,
			statusTextVisible,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatOwnerCacheHarnessResult(result: OwnerCacheHarnessResult): string {
	return [
		`Cache remembers safe defaults: ${result.cacheRemembersSafeDefaults ? "PASS" : "FAIL"}`,
		`Cache drift fails closed: ${result.cacheDriftFailsClosed ? "PASS" : "FAIL"}`,
		`Reset clears cache: ${result.resetClearsCache ? "PASS" : "FAIL"}`,
		`Layer boundary visible: ${result.layerBoundaryVisible ? "PASS" : "FAIL"}`,
		`Cache status stays visible: ${result.statusTextVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerCacheHarness()
	console.log(formatOwnerCacheHarnessResult(result))
	process.exit(
		result.cacheRemembersSafeDefaults &&
			result.cacheDriftFailsClosed &&
			result.resetClearsCache &&
			result.layerBoundaryVisible &&
			result.statusTextVisible
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:cache] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
