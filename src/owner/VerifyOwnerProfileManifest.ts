import fs from "node:fs"
import path from "node:path"

import {
	ensureCanonicalOwnerGuidedDemoManifest,
	formatOwnerProfileManifestCheckResult,
	getCanonicalOwnerGuidedDemoManifestPath,
	OWNER_GUIDED_DEMO_PROFILE_ID,
	OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH,
} from "./OwnerProfileManifest"

export type OwnerProfileManifestHarnessResult = {
	manifestCreated: boolean
	manifestStable: boolean
	driftFailsClosed: boolean
	manifestFieldsVisible: boolean
	details: string[]
}

function createHarnessRoot(): { rootDir: string; cleanup: () => void } {
	const rootDir = path.join(__dirname, "..", "..", "verification", `.tmp-owner-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(rootDir, { recursive: true })
	return {
		rootDir,
		cleanup: () => {
			if (fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true })
		},
	}
}

export async function runOwnerProfileManifestHarness(): Promise<OwnerProfileManifestHarnessResult> {
	const harness = createHarnessRoot()
	const details: string[] = []

	try {
		const first = ensureCanonicalOwnerGuidedDemoManifest(harness.rootDir)
		const second = ensureCanonicalOwnerGuidedDemoManifest(harness.rootDir)

		const manifestPath = getCanonicalOwnerGuidedDemoManifestPath(harness.rootDir)
		const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>
		raw["workspaceRelativePath"] = "verification/test_workspace"
		fs.writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8")

		const drift = ensureCanonicalOwnerGuidedDemoManifest(harness.rootDir)
		const driftText = formatOwnerProfileManifestCheckResult(drift)

		const manifestCreated = first.created && fs.existsSync(first.manifestPath)
		const manifestStable = !second.created && !second.driftDetected && second.manifest.manifestHash === first.manifest.manifestHash
		const driftFailsClosed =
			drift.driftDetected && drift.driftReasons.some((reason) => reason.includes("workspaceRelativePath"))
		const manifestFieldsVisible =
			driftText.includes(`Profile: ${OWNER_GUIDED_DEMO_PROFILE_ID}`) &&
			driftText.includes("Manifest hash:") &&
			driftText.includes(OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH.replace(/[\\/]+/g, "/"))

		details.push(`manifest=${first.manifestPath}`, `hash=${first.manifest.manifestHash}`)

		return {
			manifestCreated,
			manifestStable,
			driftFailsClosed,
			manifestFieldsVisible,
			details,
		}
	} finally {
		harness.cleanup()
	}
}

export function formatOwnerProfileManifestHarnessResult(result: OwnerProfileManifestHarnessResult): string {
	return [
		`Manifest created: ${result.manifestCreated ? "PASS" : "FAIL"}`,
		`Manifest stable on reread: ${result.manifestStable ? "PASS" : "FAIL"}`,
		`Manifest drift fails closed: ${result.driftFailsClosed ? "PASS" : "FAIL"}`,
		`Manifest fields visible: ${result.manifestFieldsVisible ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runOwnerProfileManifestHarness()
	console.log(formatOwnerProfileManifestHarnessResult(result))
	process.exit(result.manifestCreated && result.manifestStable && result.driftFailsClosed && result.manifestFieldsVisible ? 0 : 1)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:owner:profile-manifest] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
