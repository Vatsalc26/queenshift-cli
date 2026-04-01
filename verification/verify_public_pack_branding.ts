import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	publicBrand?: {
		productName?: string
		publicCliDisplayName?: string
		publicCliCommandCandidate?: string
		engineNamesRemainInternal?: string[]
	}
	futurePublicPackContents?: string[]
}

type BrandingAssetManifest = {
	brandName?: string
	publicCliDisplayName?: string
	publicCliCommandCandidate?: string
	currentSourceSheet?: string
	launchSurfaceMap?: Array<{
		surfaceId?: string
		preferredAssetId?: string
		targetPath?: string
	}>
	plannedExports?: Array<{
		id?: string
		status?: string
		targetPath?: string
	}>
	copyRules?: string[]
}

export type PublicPackBrandingHarnessResult = {
	packageScriptPresent: boolean
	brandLockDocPresent: boolean
	assetManifestPresent: boolean
	brandingReadmeOrganized: boolean
	brandingExportsReadmeReady: boolean
	exportManifestIncludesBrandFiles: boolean
	rootReadmeAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	const filePath = path.join(rootDir, relativePath)
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

function readJson<T>(rootDir: string, relativePath: string): T | null {
	try {
		return JSON.parse(readText(rootDir, relativePath)) as T
	} catch {
		return null
	}
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function arrayIncludesAll(values: string[] | undefined, expected: string[]): boolean {
	return Array.isArray(values) && expected.every((value) => values.includes(value))
}

export async function runPublicPackBrandingHarness(rootDir = resolveRootDir()): Promise<PublicPackBrandingHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const assetManifest = readJson<BrandingAssetManifest>(rootDir, path.join("public_pack", "assets", "branding", "asset_manifest.json"))
	const brandLockText = readText(rootDir, path.join("public_pack", "QUEENSHIFT_BRAND_LOCK.md"))
	const brandingReadmeText = readText(rootDir, path.join("public_pack", "assets", "branding", "README.md"))
	const brandingExportsReadmeText = readText(rootDir, path.join("public_pack", "assets", "branding", "exports", "README.md"))
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:branding"] ===
		"npm run build && node dist/verification/verify_public_pack_branding.js"
	const brandLockDocPresent = includesAll(brandLockText, [
		"# Queenshift Brand Lock",
		"## Public Product Name",
		"## Public Package And CLI Naming",
		"## Engine Naming Boundary",
		"## Asset Placement",
		"`Queenshift CLI`",
		"`queenshift-cli`",
		"`swarmengine`",
		"`queenbee`",
	])
	const plannedExports = Array.isArray(assetManifest?.plannedExports) ? assetManifest.plannedExports : []
	const launchSurfaceMap = Array.isArray(assetManifest?.launchSurfaceMap) ? assetManifest.launchSurfaceMap : []
	const assetManifestPresent =
		assetManifest?.brandName === "Queenshift" &&
		assetManifest.publicCliDisplayName === "Queenshift CLI" &&
		assetManifest.publicCliCommandCandidate === "queenshift" &&
		assetManifest.currentSourceSheet === "Queenshift.png" &&
		launchSurfaceMap.length >= 4 &&
		launchSurfaceMap.some(
			(entry) => entry.surfaceId === "github-avatar" && entry.preferredAssetId === "icon-dark" && entry.targetPath === "exports/queenshift-icon-dark.png",
		) &&
		launchSurfaceMap.some(
			(entry) =>
				entry.surfaceId === "social-preview" &&
				entry.preferredAssetId === "wordmark-dark" &&
				entry.targetPath === "exports/queenshift-wordmark-dark.png",
		) &&
		launchSurfaceMap.some(
			(entry) =>
				entry.surfaceId === "release-notes-header" &&
				entry.preferredAssetId === "wordmark-light" &&
				entry.targetPath === "exports/queenshift-wordmark-light.png",
		) &&
		launchSurfaceMap.some(
			(entry) =>
				entry.surfaceId === "blog-header" &&
				entry.preferredAssetId === "app-tile-dark" &&
				entry.targetPath === "exports/queenshift-app-tile-dark.png",
		) &&
		plannedExports.length >= 4 &&
		plannedExports.every(
			(entry) => entry.status === "planned" && typeof entry.targetPath === "string" && entry.targetPath.startsWith("exports/"),
		) &&
		plannedExports.every((entry) => typeof entry.targetPath === "string" && entry.targetPath.includes("queenshift-")) &&
		fs.existsSync(path.join(rootDir, "public_pack", "assets", "branding", "Queenshift.png")) &&
		fs.existsSync(path.join(rootDir, "public_pack", "assets", "branding", "exports", "README.md"))
	const brandingReadmeOrganized = includesAll(brandingReadmeText, [
		"`Queenshift.png`",
		"`asset_manifest.json`",
		"`exports/`",
		"source sheet",
		"canonical naming and placement map",
		"GitHub avatar",
		"social preview",
		"release notes header",
	])
	const brandingExportsReadmeReady = includesAll(brandingExportsReadmeText, [
		"GitHub avatar",
		"social preview",
		"release notes",
		"launch-blog",
	])
	const futurePackContents = Array.isArray(exportManifest?.futurePublicPackContents) ? exportManifest.futurePublicPackContents : []
	const exportManifestIncludesBrandFiles =
		exportManifest?.publicBrand?.productName === "Queenshift" &&
		exportManifest.publicBrand.publicCliDisplayName === "Queenshift CLI" &&
		exportManifest.publicBrand.publicCliCommandCandidate === "queenshift" &&
		arrayIncludesAll(exportManifest.publicBrand.engineNamesRemainInternal, ["swarmengine", "queenbee"]) &&
		arrayIncludesAll(futurePackContents, [
			"QUEENSHIFT_BRAND_LOCK.md",
			"assets/branding/asset_manifest.json",
			"assets/branding/exports/README.md",
			"assets/branding/Queenshift.png",
		])
	const rootReadmeAligned = includesAll(readmeText, [
		"## Future Public Brand Lock",
		"`Queenshift` is the future public product name",
		"`Queenshift CLI`",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` stays experimental",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 257 turns the brand pack and evidence page into bounded launch-story inputs",
		"**Session:** 257",
		"`public_pack/assets/branding/asset_manifest.json`",
		"`public_pack/LAUNCH_BLOG_INPUTS.md`",
		"`public_pack/RELEASE_NOTES_DRAFT.md`",
		"`public_pack/docs/evidence.md`",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Are launch assets and launch-story inputs now prepared for the future public repo without widening the bounded claim?",
		"`public_pack/assets/branding/asset_manifest.json`",
		"`public_pack/LAUNCH_BLOG_INPUTS.md`",
		"`public_pack/RELEASE_NOTES_DRAFT.md`",
		"`npm.cmd run verify:public-pack:branding`",
	])

	details.push(
		`plannedExports=${plannedExports.length}`,
		`launchSurfaceMap=${launchSurfaceMap.length}`,
		`brandLockDocPresent=${brandLockDocPresent ? "yes" : "no"}`,
		`exportManifestIncludesBrandFiles=${exportManifestIncludesBrandFiles ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		brandLockDocPresent,
		assetManifestPresent,
		brandingReadmeOrganized,
		brandingExportsReadmeReady,
		exportManifestIncludesBrandFiles,
		rootReadmeAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackBrandingHarnessResult(result: PublicPackBrandingHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Brand lock doc present: ${result.brandLockDocPresent ? "PASS" : "FAIL"}`,
		`Asset manifest present: ${result.assetManifestPresent ? "PASS" : "FAIL"}`,
		`Branding README organized: ${result.brandingReadmeOrganized ? "PASS" : "FAIL"}`,
		`Branding exports README ready: ${result.brandingExportsReadmeReady ? "PASS" : "FAIL"}`,
		`Export manifest includes brand files: ${result.exportManifestIncludesBrandFiles ? "PASS" : "FAIL"}`,
		`Root README aligned: ${result.rootReadmeAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackBrandingHarness()
	console.log(formatPublicPackBrandingHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.brandLockDocPresent &&
			result.assetManifestPresent &&
			result.brandingReadmeOrganized &&
			result.brandingExportsReadmeReady &&
			result.exportManifestIncludesBrandFiles &&
			result.rootReadmeAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:branding] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
