import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const OWNER_GUIDED_DEMO_PROFILE_ID = "owner-guided-demo-v1"
export const OWNER_GUIDED_DEMO_SURFACE = "owner_guided_demo"
export const OWNER_GUIDED_DEMO_TASK = "add a brief comment to hello.ts"
export const OWNER_GUIDED_DEMO_PROVIDER = "gemini"
export const OWNER_GUIDED_DEMO_AUTH_MODE = "cli"
export const OWNER_GUIDED_DEMO_MODEL = "gemini-2.5-flash"
export const OWNER_GUIDED_DEMO_TIMEOUT_MS = 420_000
export const OWNER_GUIDED_DEMO_BASELINE_MARKER = "dogfood:"
export const OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH = path.join("verification", "dogfood_repo_copy_final")
export const OWNER_GUIDED_DEMO_PROFILE_RELATIVE_PATH = path.join("owner_profiles", "canonical-guided-demo.profile.json")
export const OWNER_GUIDED_DEMO_NON_CREDIT_REASON = "Owner guided demo surface is non-credit by design."

type OwnerProfileManifestCore = {
	version: 1
	profileId: string
	surface: string
	workspaceRelativePath: string
	workspaceBaselineMarker: string
	providerPath: string
	provider: string
	authMode: string
	model: string
	timeoutMs: number
	task: string
	creditEligible: false
	creditPolicy: "non_credit"
	nonCreditReason: string
}

export type OwnerProfileManifest = OwnerProfileManifestCore & {
	manifestHash: string
}

export type OwnerProfileManifestCheckResult = {
	manifest: OwnerProfileManifest
	manifestPath: string
	created: boolean
	driftDetected: boolean
	driftReasons: string[]
}

function normalizeRelPath(relativePath: string): string {
	return relativePath.replace(/[\\/]+/g, "/")
}

function buildCanonicalOwnerGuidedDemoManifestCore(): OwnerProfileManifestCore {
	return {
		version: 1,
		profileId: OWNER_GUIDED_DEMO_PROFILE_ID,
		surface: OWNER_GUIDED_DEMO_SURFACE,
		workspaceRelativePath: normalizeRelPath(OWNER_GUIDED_DEMO_WORKSPACE_RELATIVE_PATH),
		workspaceBaselineMarker: OWNER_GUIDED_DEMO_BASELINE_MARKER,
		providerPath: "gemini_cli_oauth",
		provider: OWNER_GUIDED_DEMO_PROVIDER,
		authMode: OWNER_GUIDED_DEMO_AUTH_MODE,
		model: OWNER_GUIDED_DEMO_MODEL,
		timeoutMs: OWNER_GUIDED_DEMO_TIMEOUT_MS,
		task: OWNER_GUIDED_DEMO_TASK,
		creditEligible: false,
		creditPolicy: "non_credit",
		nonCreditReason: OWNER_GUIDED_DEMO_NON_CREDIT_REASON,
	}
}

function computeManifestHash(core: OwnerProfileManifestCore): string {
	return crypto.createHash("sha256").update(JSON.stringify(core)).digest("hex")
}

function buildCanonicalOwnerGuidedDemoManifest(): OwnerProfileManifest {
	const core = buildCanonicalOwnerGuidedDemoManifestCore()
	return {
		...core,
		manifestHash: computeManifestHash(core),
	}
}

function parseManifest(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw) as unknown
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

function validateManifest(actual: Record<string, unknown> | null, expected: OwnerProfileManifest): string[] {
	if (!actual) return ["Manifest is not valid JSON."]

	const fields: Array<keyof OwnerProfileManifest> = [
		"version",
		"profileId",
		"surface",
		"workspaceRelativePath",
		"workspaceBaselineMarker",
		"providerPath",
		"provider",
		"authMode",
		"model",
		"timeoutMs",
		"task",
		"creditEligible",
		"creditPolicy",
		"nonCreditReason",
		"manifestHash",
	]

	const reasons: string[] = []
	for (const field of fields) {
		const actualValue = actual[field]
		const expectedValue = expected[field]
		if (actualValue !== expectedValue) {
			reasons.push(`Field drift: ${String(field)} expected ${JSON.stringify(expectedValue)} but found ${JSON.stringify(actualValue)}`)
		}
	}

	return reasons
}

export function getCanonicalOwnerGuidedDemoManifestPath(rootDir: string): string {
	return path.join(rootDir, OWNER_GUIDED_DEMO_PROFILE_RELATIVE_PATH)
}

export function ensureCanonicalOwnerGuidedDemoManifest(rootDir: string): OwnerProfileManifestCheckResult {
	const manifest = buildCanonicalOwnerGuidedDemoManifest()
	const manifestPath = getCanonicalOwnerGuidedDemoManifestPath(rootDir)

	if (!fs.existsSync(manifestPath)) {
		fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
		fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
		return {
			manifest,
			manifestPath,
			created: true,
			driftDetected: false,
			driftReasons: [],
		}
	}

	const actual = parseManifest(fs.readFileSync(manifestPath, "utf8"))
	const driftReasons = validateManifest(actual, manifest)
	return {
		manifest,
		manifestPath,
		created: false,
		driftDetected: driftReasons.length > 0,
		driftReasons,
	}
}

export function formatOwnerProfileManifestCheckResult(result: OwnerProfileManifestCheckResult): string {
	return [
		`Owner profile manifest: ${result.driftDetected ? "FAIL" : "PASS"}`,
		`Profile: ${result.manifest.profileId}`,
		`Manifest: ${result.manifestPath}`,
		`Manifest hash: ${result.manifest.manifestHash}`,
		`Created: ${result.created ? "yes" : "no"}`,
		`Workspace: ${result.manifest.workspaceRelativePath}`,
		`Provider path: ${result.manifest.providerPath}`,
		`Task: ${result.manifest.task}`,
		...(result.driftReasons.length > 0 ? ["Drift reasons:", ...result.driftReasons.map((reason) => `- ${reason}`)] : []),
	].join("\n")
}
