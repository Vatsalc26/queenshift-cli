import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	futurePublicPackContents?: string[]
}

type ZenodoMetadata = {
	title?: string
	upload_type?: string
	description?: string
	creators?: Array<{ name?: string }>
	license?: string
	access_right?: string
	keywords?: string[]
	version?: string
	notes?: string
}

export type PublicPackReleaseDocsHarnessResult = {
	packageScriptPresent: boolean
	authorsDocPresent: boolean
	citationDocPresent: boolean
	zenodoMetadataPresent: boolean
	changelogPresent: boolean
	launchBlogInputsPresent: boolean
	releaseNotesDraftPresent: boolean
	contributingDocPresent: boolean
	codeOfConductPresent: boolean
	securityDocPresent: boolean
	licensePresent: boolean
	exportManifestIncludesReleaseDocs: boolean
	publicReadmeReferencesReleaseDocs: boolean
	boundaryDocListsReleaseDocs: boolean
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

export async function runPublicPackReleaseDocsHarness(
	rootDir = resolveRootDir(),
): Promise<PublicPackReleaseDocsHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		version?: string
		scripts?: Record<string, string>
	}
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const publicReadmeText = readText(rootDir, path.join("public_pack", "README.md"))
	const boundaryText = readText(rootDir, path.join("public_pack", "PUBLIC_EXPORT_BOUNDARY.md"))
	const authorsText = readText(rootDir, path.join("public_pack", "AUTHORS.md"))
	const citationText = readText(rootDir, path.join("public_pack", "CITATION.cff"))
	const zenodoMetadata = readJson<ZenodoMetadata>(rootDir, path.join("public_pack", ".zenodo.json"))
	const changelogText = readText(rootDir, path.join("public_pack", "CHANGELOG.md"))
	const launchBlogInputsText = readText(rootDir, path.join("public_pack", "LAUNCH_BLOG_INPUTS.md"))
	const releaseNotesDraftText = readText(rootDir, path.join("public_pack", "RELEASE_NOTES_DRAFT.md"))
	const contributingText = readText(rootDir, path.join("public_pack", "CONTRIBUTING.md"))
	const codeOfConductText = readText(rootDir, path.join("public_pack", "CODE_OF_CONDUCT.md"))
	const securityText = readText(rootDir, path.join("public_pack", "SECURITY.md"))
	const publicLicenseText = readText(rootDir, path.join("public_pack", "LICENSE"))
	const rootLicenseText = readText(rootDir, "LICENSE")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:release-docs"] ===
		"npm run build && node dist/verification/verify_public_pack_release_docs.js"
	const authorsDocPresent = includesAll(authorsText, [
		"# Authors",
		"Vatsal Chavda",
		"later contributors should be credited",
		"curated public history",
	])
	const citationDocPresent = includesAll(citationText, [
		"cff-version: 1.2.0",
		'title: "Queenshift"',
		"type: software",
		'family-names: "Chavda"',
		'given-names: "Vatsal"',
		'license: "MIT"',
		`version: "${packageJson.version ?? ""}"`,
	])
	const zenodoMetadataPresent =
		zenodoMetadata?.title === "Queenshift" &&
		zenodoMetadata.upload_type === "software" &&
		typeof zenodoMetadata.description === "string" &&
		zenodoMetadata.description.includes("bounded coding CLI") &&
		Array.isArray(zenodoMetadata.creators) &&
		zenodoMetadata.creators.some((creator) => creator.name === "Chavda, Vatsal") &&
		zenodoMetadata.license === "MIT" &&
		zenodoMetadata.access_right === "open" &&
		Array.isArray(zenodoMetadata.keywords) &&
		zenodoMetadata.keywords.includes("queenshift") &&
		zenodoMetadata.version === (packageJson.version ?? "") &&
		typeof zenodoMetadata.notes === "string" &&
		zenodoMetadata.notes.includes("public software release") &&
		zenodoMetadata.notes.includes("package.json") &&
		zenodoMetadata.notes.includes("CITATION.cff") &&
		zenodoMetadata.notes.includes(".zenodo.json") &&
		zenodoMetadata.notes.includes("CHANGELOG.md")
	const changelogPresent = includesAll(changelogText, [
		"# Changelog",
		"## Unreleased",
		"public product changes",
		"0.1.0-rc1",
		".zenodo.json",
		"package.json",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"`bounded_node_cli_task`",
	])
	const launchBlogInputsPresent = includesAll(launchBlogInputsText, [
		"# Queenshift Launch Blog Inputs",
		"## Launch Claim",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"`QB-LIVE-01`",
		"`QB-LIVE-GW-01`",
		"wins=`0`",
		"unresolved=`30/30`",
		"`queenshift doctor`",
	])
	const releaseNotesDraftPresent = includesAll(releaseNotesDraftText, [
		"# Queenshift 0.1.0-rc1 Experimental Release Notes",
		"## What This Release Is",
		"## Highlights",
		"## Evidence And Boundaries",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"`QB-LIVE-01`",
		"`QB-LIVE-GW-01`",
		"unresolved=`30/30`",
		"docs/evidence.md",
	])
	const contributingDocPresent = includesAll(contributingText, [
		"# Contributing to Queenshift",
		"proof-first",
		"`CODE_OF_CONDUCT.md`",
		"`SECURITY.md`",
		"`npm.cmd test`",
		"issue templates",
		"do not widen the public claim",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
	])
	const codeOfConductPresent = includesAll(codeOfConductText, [
		"# Queenshift Code Of Conduct",
		"## Expected Behavior",
		"## Unacceptable Behavior",
		"## Reporting",
		"`SECURITY.md`",
	])
	const securityDocPresent = includesAll(securityText, [
		"# Queenshift Security",
		"## What To Report",
		"## What Not To File Here",
		"## How To Report",
		"if this repo provides one",
		"Use the public bug template for normal bugs",
	])
	const licensePresent = rootLicenseText.length > 0 && publicLicenseText === rootLicenseText
	const exportManifestIncludesReleaseDocs = arrayIncludesAll(exportManifest?.futurePublicPackContents, [
		"AUTHORS.md",
		"CITATION.cff",
		".zenodo.json",
		"CHANGELOG.md",
		"CONTRIBUTING.md",
		"CODE_OF_CONDUCT.md",
		"SECURITY.md",
		"LICENSE",
	])
	const publicReadmeReferencesReleaseDocs = includesAll(publicReadmeText, [
		"[AUTHORS.md](./AUTHORS.md)",
		"[CITATION.cff](./CITATION.cff)",
		"[.zenodo.json](./.zenodo.json)",
		"[CHANGELOG.md](./CHANGELOG.md)",
		"[CONTRIBUTING.md](./CONTRIBUTING.md)",
		"[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)",
		"[SECURITY.md](./SECURITY.md)",
		"[LICENSE](./LICENSE)",
	])
	const boundaryDocListsReleaseDocs = includesAll(boundaryText, [
		"`public_pack/AUTHORS.md`",
		"`public_pack/CITATION.cff`",
		"`public_pack/.zenodo.json`",
		"`public_pack/CHANGELOG.md`",
		"`public_pack/CONTRIBUTING.md`",
		"`public_pack/CODE_OF_CONDUCT.md`",
		"`public_pack/SECURITY.md`",
		"`public_pack/LICENSE`",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 255 adds Zenodo-ready release metadata before export-verification and launch work",
		"**Session:** 255",
		"`public_pack/.zenodo.json`",
		"`CITATION.cff`",
		"`CHANGELOG.md`",
		"version-aligned",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Does the future public pack now carry citation, changelog, and Zenodo-ready metadata that stay version-aligned for the first public release?",
		"`public_pack/CITATION.cff`",
		"`public_pack/.zenodo.json`",
		"`public_pack/CHANGELOG.md`",
		"`npm.cmd run verify:public-pack:release-docs`",
	])

	details.push(
		`exportManifestIncludesReleaseDocs=${exportManifestIncludesReleaseDocs ? "yes" : "no"}`,
		`licenseMatchesRoot=${licensePresent ? "yes" : "no"}`,
		`zenodoMetadataPresent=${zenodoMetadataPresent ? "yes" : "no"}`,
		`publicReadmeReferencesReleaseDocs=${publicReadmeReferencesReleaseDocs ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		authorsDocPresent,
		citationDocPresent,
		zenodoMetadataPresent,
		changelogPresent,
		launchBlogInputsPresent,
		releaseNotesDraftPresent,
		contributingDocPresent,
		codeOfConductPresent,
		securityDocPresent,
		licensePresent,
		exportManifestIncludesReleaseDocs,
		publicReadmeReferencesReleaseDocs,
		boundaryDocListsReleaseDocs,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackReleaseDocsHarnessResult(result: PublicPackReleaseDocsHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Authors doc present: ${result.authorsDocPresent ? "PASS" : "FAIL"}`,
		`Citation doc present: ${result.citationDocPresent ? "PASS" : "FAIL"}`,
		`Zenodo metadata present: ${result.zenodoMetadataPresent ? "PASS" : "FAIL"}`,
		`Changelog present: ${result.changelogPresent ? "PASS" : "FAIL"}`,
		`Launch blog inputs present: ${result.launchBlogInputsPresent ? "PASS" : "FAIL"}`,
		`Release notes draft present: ${result.releaseNotesDraftPresent ? "PASS" : "FAIL"}`,
		`Contributing doc present: ${result.contributingDocPresent ? "PASS" : "FAIL"}`,
		`Code of conduct present: ${result.codeOfConductPresent ? "PASS" : "FAIL"}`,
		`Security doc present: ${result.securityDocPresent ? "PASS" : "FAIL"}`,
		`License present: ${result.licensePresent ? "PASS" : "FAIL"}`,
		`Export manifest includes release docs: ${result.exportManifestIncludesReleaseDocs ? "PASS" : "FAIL"}`,
		`Public README references release docs: ${result.publicReadmeReferencesReleaseDocs ? "PASS" : "FAIL"}`,
		`Boundary doc lists release docs: ${result.boundaryDocListsReleaseDocs ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackReleaseDocsHarness()
	console.log(formatPublicPackReleaseDocsHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.authorsDocPresent &&
			result.citationDocPresent &&
			result.zenodoMetadataPresent &&
			result.changelogPresent &&
			result.launchBlogInputsPresent &&
			result.releaseNotesDraftPresent &&
			result.contributingDocPresent &&
			result.codeOfConductPresent &&
			result.securityDocPresent &&
			result.licensePresent &&
			result.exportManifestIncludesReleaseDocs &&
			result.publicReadmeReferencesReleaseDocs &&
			result.boundaryDocListsReleaseDocs &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:release-docs] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
