import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	futurePublicPackContents?: string[]
}

export type PublicPackReadmeHarnessResult = {
	packageScriptPresent: boolean
	publicReadmePresent: boolean
	publicReadmeStaysBounded: boolean
	exportManifestIncludesPublicDocs: boolean
	publicDocsIndexPresent: boolean
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

export async function runPublicPackReadmeHarness(rootDir = resolveRootDir()): Promise<PublicPackReadmeHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const publicReadmeText = readText(rootDir, path.join("public_pack", "README.md"))
	const docsIndexText = readText(rootDir, path.join("public_pack", "docs", "README.md"))
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:readme"] === "npm run build && node dist/verification/verify_public_pack_readme.js"
	const publicReadmePresent = includesAll(publicReadmeText, [
		"# Queenshift",
		"Queenshift is a bounded coding CLI",
		"## Start Here",
		"## What This Beta Is Good At",
		"## What This Beta Does Not Claim",
		"## Production-Ready CLI Answer",
		"[docs/install.md](./docs/install.md)",
		"[QUICKSTART.md](./QUICKSTART.md)",
	])
	const publicReadmeStaysBounded = includesAll(publicReadmeText, [
		"local Windows bundle",
		"public product command is `queenshift`",
		"`queenshift-cli`",
		"`npm link`",
		"`queenshift`",
		"experimental public release",
		"normal-user production-ready CLI answer is still `NO`",
		"published normal-user install command",
		"broad general-use readiness remains out of scope",
		"checkout-only preparation stays in `docs/install.md` and `QUICKSTART.md`",
		"## Calm Product Path",
		"queenshift doctor",
		"queenshift owner:guided:demo",
		"queenshift demo:run",
		"queenshift repo:onboard --workspace <repo>",
		'queenshift "<task>" --workspace <repo> --admitOnly',
		"--admitOnly",
		"short recovery loop",
		"shows what failed",
		"shows the safest next command",
		"shows the recorded timeline",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"fixed benchmark scoreboard is still unresolved",
		"This repo is intentionally curated and keeps the claim bounded.",
	]) &&
		!publicReadmeText.includes("npm.cmd test") &&
		!publicReadmeText.includes("npm.cmd link")
	const exportManifestIncludesPublicDocs = arrayIncludesAll(exportManifest?.futurePublicPackContents, [
		"README.md",
		"QUICKSTART.md",
		"docs/README.md",
	])
	const publicDocsIndexPresent = includesAll(docsIndexText, [
		"# Queenshift Public Docs",
		"`../README.md`",
		"`../QUICKSTART.md`",
		"Private maintainer planning docs, launch drafts, and export-prep notes are intentionally kept out of this public repo.",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 266 records the final production-ready normal-user CLI gate as `NO`",
		"**Session:** 266",
		"published normal-user install command",
		"local Windows bundle",
		"experimental public release surface",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Is the production-ready normal-user CLI answer now explicit and truthful even though the answer is still `NO`?",
		"`public_pack/README.md`",
		"`public_pack/QUICKSTART.md`",
		"`npm.cmd run verify:queenshift:command`",
		"`npm.cmd run verify:public-pack:readme`",
	])

	details.push(
		`exportManifestIncludesPublicDocs=${exportManifestIncludesPublicDocs ? "yes" : "no"}`,
		`publicDocsIndexPresent=${publicDocsIndexPresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		publicReadmePresent,
		publicReadmeStaysBounded,
		exportManifestIncludesPublicDocs,
		publicDocsIndexPresent,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackReadmeHarnessResult(result: PublicPackReadmeHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Public README present: ${result.publicReadmePresent ? "PASS" : "FAIL"}`,
		`Public README stays bounded: ${result.publicReadmeStaysBounded ? "PASS" : "FAIL"}`,
		`Export manifest includes public docs: ${result.exportManifestIncludesPublicDocs ? "PASS" : "FAIL"}`,
		`Public docs index present: ${result.publicDocsIndexPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackReadmeHarness()
	console.log(formatPublicPackReadmeHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.publicReadmePresent &&
			result.publicReadmeStaysBounded &&
			result.exportManifestIncludesPublicDocs &&
			result.publicDocsIndexPresent &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:readme] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
