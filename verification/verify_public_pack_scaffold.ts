import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	packId?: string
	productName?: string
	exportRoot?: string
	status?: string
	freshPublicRepoOnly?: boolean
	copyGitHistory?: boolean
	futurePublicPackContents?: string[]
	privateLabOnlyGlobs?: string[]
	notes?: string[]
}

export type PublicPackScaffoldHarnessResult = {
	packageScriptPresent: boolean
	scaffoldReadmePresent: boolean
	boundaryDocPresent: boolean
	manifestPresent: boolean
	manifestListsExistingPackFiles: boolean
	manifestBlocksPrivateLabHistory: boolean
	readmeBoundaryAligned: boolean
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

function readManifest(rootDir: string): PublicPackExportManifest | null {
	try {
		return JSON.parse(readText(rootDir, path.join("public_pack", "export_manifest.json"))) as PublicPackExportManifest
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

export async function runPublicPackScaffoldHarness(rootDir = resolveRootDir()): Promise<PublicPackScaffoldHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const manifest = readManifest(rootDir)
	const publicPackReadmeText = readText(rootDir, path.join("public_pack", "README.md"))
	const boundaryText = readText(rootDir, path.join("public_pack", "PUBLIC_EXPORT_BOUNDARY.md"))
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:scaffold"] ===
		"npm run build && node dist/verification/verify_public_pack_scaffold.js"
	const scaffoldReadmePresent =
		fs.existsSync(path.join(rootDir, "public_pack", "README.md")) && publicPackReadmeText.includes("Queenshift")
	const boundaryDocPresent = includesAll(boundaryText, [
		"# Queenshift Public Export Boundary",
		"## Future Public-Facing Surface",
		"## Private-Lab-Only Surface",
		"## Candidate And Internal-Only Surface",
		"## Export Rules",
	])
	const manifestPresent =
		manifest?.packId === "queenshift-public-pack-scaffold" &&
		manifest.productName === "Queenshift" &&
		manifest.exportRoot === "public_pack" &&
		typeof manifest.status === "string"
	const futurePackContents = Array.isArray(manifest?.futurePublicPackContents) ? manifest.futurePublicPackContents : []
	const manifestListsExistingPackFiles =
		manifest?.freshPublicRepoOnly === true &&
		manifest.copyGitHistory === false &&
		futurePackContents.length >= 5 &&
		futurePackContents.every((relativePath) => fs.existsSync(path.join(rootDir, "public_pack", relativePath)))
	const manifestBlocksPrivateLabHistory =
		arrayIncludesAll(manifest?.privateLabOnlyGlobs, [
			"Coding_sessions/**",
			"legacy_v1_docs/**",
			".swarm/**",
			".swarm-worktrees/**",
			"RC1_DAILY_DRIVER_LOG.json",
			"QUEENBEE_*.md",
			"QUEENSHIFT_PRODUCT_READINESS_STACK.md",
			"VERIFICATION_CATALOG.md",
			"COMPARATIVE_BENCHMARK_REPORT.md",
			"HEXMESH_PUBLIC_EXPORT_GATE.md",
		]) &&
		includesAll(boundaryText, [
			"`Coding_sessions/`",
			"`legacy_v1_docs/`",
			"`QUEENBEE_*.md`",
			"`QUEENSHIFT_PRODUCT_READINESS_STACK.md`",
			"`VERIFICATION_CATALOG.md`",
			"`COMPARATIVE_BENCHMARK_REPORT.md`",
			"`HEXMESH_PUBLIC_EXPORT_GATE.md`",
			"visibility flip",
		])
	const readmeBoundaryAligned = includesAll(readmeText, [
		"## Future Public-Pack Boundary",
		"`public_pack/`",
		"fresh public repo",
		"visibility flip",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` stays experimental",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 203 creates a curated public-pack scaffold instead of publishing the lab repo",
		"**Session:** 203",
		"`public_pack/`",
		"fresh public repo",
		"`Coding_sessions/`",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Is the current private lab repo meant to become the public repo by flipping visibility?",
		"curated `public_pack/` files",
		"candidate-only QueenBee docs private-lab-only",
	])

	details.push(
		`packageScriptPresent=${packageScriptPresent ? "yes" : "no"}`,
		`futurePackContents=${futurePackContents.length}`,
		`manifestBlocksPrivateLabHistory=${manifestBlocksPrivateLabHistory ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		scaffoldReadmePresent,
		boundaryDocPresent,
		manifestPresent,
		manifestListsExistingPackFiles,
		manifestBlocksPrivateLabHistory,
		readmeBoundaryAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackScaffoldHarnessResult(result: PublicPackScaffoldHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Scaffold README present: ${result.scaffoldReadmePresent ? "PASS" : "FAIL"}`,
		`Boundary doc present: ${result.boundaryDocPresent ? "PASS" : "FAIL"}`,
		`Manifest present: ${result.manifestPresent ? "PASS" : "FAIL"}`,
		`Manifest lists existing pack files: ${result.manifestListsExistingPackFiles ? "PASS" : "FAIL"}`,
		`Manifest blocks private-lab history: ${result.manifestBlocksPrivateLabHistory ? "PASS" : "FAIL"}`,
		`Root README boundary aligned: ${result.readmeBoundaryAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackScaffoldHarness()
	console.log(formatPublicPackScaffoldHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.scaffoldReadmePresent &&
			result.boundaryDocPresent &&
			result.manifestPresent &&
			result.manifestListsExistingPackFiles &&
			result.manifestBlocksPrivateLabHistory &&
			result.readmeBoundaryAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:scaffold] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
