import fs from "node:fs"
import path from "node:path"

type PublicPackExportManifest = {
	status?: string
	freshPublicRepoOnly?: boolean
	copyGitHistory?: boolean
	futurePublicPackContents?: string[]
	freshPublicRepoFileMap?: Record<string, string>
	boundedBetaExportTruth?: {
		shippedEngine?: string
		experimentalEngine?: string
		queenBeePublicPosition?: string
		boundedQueenBeeFamilies?: string[]
		handoffDoc?: string
	}
}

export type PublicPackExportHarnessResult = {
	packageScriptPresent: boolean
	exportGateDocPresent: boolean
	handoffDocPresent: boolean
	manifestStatusExportReady: boolean
	manifestFileMapExplicit: boolean
	boundaryStillFreshRepoOnly: boolean
	readmeGateAligned: boolean
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

function fileMapCoversContents(
	rootDir: string,
	fileMap: Record<string, string> | undefined,
	contents: string[] | undefined,
): boolean {
	if (!fileMap || !Array.isArray(contents) || contents.length === 0) return false
	return contents.every((relativePath) => fileMap[relativePath] === relativePath && fs.existsSync(path.join(rootDir, "public_pack", relativePath)))
}

export async function runPublicPackExportHarness(rootDir = resolveRootDir()): Promise<PublicPackExportHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const exportManifest = readJson<PublicPackExportManifest>(rootDir, path.join("public_pack", "export_manifest.json"))
	const exportGateText = readText(rootDir, "HEXMESH_PUBLIC_EXPORT_GATE.md")
	const handoffText = readText(rootDir, path.join("public_pack", "FRESH_PUBLIC_REPO_HANDOFF.md"))
	const boundaryText = readText(rootDir, path.join("public_pack", "PUBLIC_EXPORT_BOUNDARY.md"))
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:public-pack:export"] === "npm run build && node dist/verification/verify_public_pack_export.js"
	const exportGateDocPresent = includesAll(exportGateText, [
		"# Queenshift Public Export Gate",
		"Current gate answer: `GO_FOR_CURATED_EXPORT`",
		"`2026-03-27`",
		"`public_pack/FRESH_PUBLIC_REPO_HANDOFF.md`",
		"`public_pack/export_manifest.json`",
		"fresh public GitHub repo",
		"`swarmengine` as the shipped bounded engine",
		"`queenbee` experimental and bounded",
	])
	const handoffDocPresent = includesAll(handoffText, [
		"# Fresh Public Repo Handoff",
		"`GO_FOR_CURATED_EXPORT`",
		"`READY_FOR_EXPERIMENTAL_PUBLIC_RELEASE`",
		"fresh public GitHub repo",
		"## Pre-Copy Checks",
		"## Keep Out Of The Export",
		"## Post-Copy Checks",
		"`README.md`",
		"`.zenodo.json`",
		"`docs/evidence.md`",
		"`FRESH_PUBLIC_REPO_HANDOFF.md`",
		"`assets/branding/Queenshift.png`",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
	])
	const manifestStatusExportReady =
		exportManifest?.status === "export-ready" &&
		exportManifest.freshPublicRepoOnly === true &&
		exportManifest.copyGitHistory === false &&
		exportManifest.boundedBetaExportTruth?.shippedEngine === "swarmengine" &&
		exportManifest.boundedBetaExportTruth.experimentalEngine === "queenbee" &&
		exportManifest.boundedBetaExportTruth.queenBeePublicPosition === "experimental_bounded_beta_only" &&
		exportManifest.boundedBetaExportTruth.handoffDoc === "FRESH_PUBLIC_REPO_HANDOFF.md" &&
		arrayIncludesAll(exportManifest.boundedBetaExportTruth.boundedQueenBeeFamilies, [
			"comment_file",
			"update_named_file",
			"bounded_two_file_update",
			"update_file_and_test",
			"rename_export",
			"bounded_node_cli_task",
		])
	const manifestFileMapExplicit =
		arrayIncludesAll(exportManifest?.futurePublicPackContents, ["README.md", "LICENSE", ".zenodo.json", "docs/README.md"]) &&
		fileMapCoversContents(rootDir, exportManifest?.freshPublicRepoFileMap, exportManifest?.futurePublicPackContents)
	const boundaryStillFreshRepoOnly = includesAll(boundaryText, [
		"Private maintainer launch and export-prep files",
		"`FRESH_PUBLIC_REPO_HANDOFF.md` and `export_manifest.json`",
		"visibility flip",
		"Nothing outside `public_pack/` moves into the fresh public repo",
		"If a file is not listed in `FRESH_PUBLIC_REPO_HANDOFF.md` and `export_manifest.json`, it stays out of the export.",
		"experimental public release only",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"Audit each candidate public file individually before export",
		"Treat filenames such as `DRAFT`, `INPUTS`, `HANDOFF`, `BOUNDARY`, `LOCK`, `manifest`, and `PLAN` as private by default",
	])
	const readmeGateAligned = includesAll(readmeText, [
		"Session 214 export gate:",
		"`HEXMESH_PUBLIC_EXPORT_GATE.md`",
		"`QUEENBEE_BETA_GATE.md`",
		"`npm.cmd run verify:public-pack:export`",
		"Session `215+` stays blocked",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 256 re-verifies the fresh public repo export as a manifest-only curated copy set",
		"**Session:** 256",
		"manifest-only curated copy set",
		"`public_pack/export_manifest.json`",
		"`public_pack/FRESH_PUBLIC_REPO_HANDOFF.md`",
		"`public_pack/` files belong in the future public repo",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Is the fresh public repo export set now re-verified as complete, curated, and leakage-safe before launch assets and the final gate?",
		"`public_pack/FRESH_PUBLIC_REPO_HANDOFF.md`",
		"`npm.cmd run verify:public-pack:export`",
		"`npm.cmd run verify:public-pack:scaffold`",
	])

	details.push(
		`manifestStatus=${String(exportManifest?.status ?? "")}`,
		`futurePublicPackContents=${Array.isArray(exportManifest?.futurePublicPackContents) ? exportManifest.futurePublicPackContents.length : 0}`,
		`manifestFileMapExplicit=${manifestFileMapExplicit ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		exportGateDocPresent,
		handoffDocPresent,
		manifestStatusExportReady,
		manifestFileMapExplicit,
		boundaryStillFreshRepoOnly,
		readmeGateAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatPublicPackExportHarnessResult(result: PublicPackExportHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Export gate doc present: ${result.exportGateDocPresent ? "PASS" : "FAIL"}`,
		`Handoff doc present: ${result.handoffDocPresent ? "PASS" : "FAIL"}`,
		`Manifest status export-ready: ${result.manifestStatusExportReady ? "PASS" : "FAIL"}`,
		`Manifest file map explicit: ${result.manifestFileMapExplicit ? "PASS" : "FAIL"}`,
		`Boundary still fresh-repo-only: ${result.boundaryStillFreshRepoOnly ? "PASS" : "FAIL"}`,
		`Readme gate aligned: ${result.readmeGateAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runPublicPackExportHarness()
	console.log(formatPublicPackExportHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.exportGateDocPresent &&
			result.handoffDocPresent &&
			result.manifestStatusExportReady &&
			result.manifestFileMapExplicit &&
			result.boundaryStillFreshRepoOnly &&
			result.readmeGateAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:public-pack:export] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
