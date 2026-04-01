import fs from "node:fs"
import path from "node:path"

export type QueenBeeBetaGateHarnessResult = {
	packageScriptPresent: boolean
	betaGateDocPresent: boolean
	proofBundleExplicit: boolean
	sixFamilySetExplicit: boolean
	readmeGateAligned: boolean
	verificationCatalogAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.existsSync(path.join(rootDir, relativePath)) ? fs.readFileSync(path.join(rootDir, relativePath), "utf8") : ""
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeBetaGateHarness(rootDir = resolveRootDir()): Promise<QueenBeeBetaGateHarnessResult> {
	const details: string[] = []
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const betaGateText = readText(rootDir, "QUEENBEE_BETA_GATE.md")
	const readmeText = readText(rootDir, "Readme.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:beta-gate"] === "npm run build && node dist/verification/verify_queenbee_beta_gate.js"
	const betaGateDocPresent = includesAll(betaGateText, [
		"# QueenBee Beta Gate",
		"Current gate answer: `EXPERIMENTAL_BETA_OK`",
		"`2026-03-27`",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
		"`--engine queenbee` still stays candidate-only",
	])
	const proofBundleExplicit = includesAll(betaGateText, [
		"`npm.cmd run verify:queenbee:beta-contract`",
		"`npm.cmd run verify:queenbee:jsts:core`",
		"`npm.cmd run verify:queenbee:jsts:async`",
		"`npm.cmd run verify:queenbee:jsts:node`",
		"`npm.cmd run verify:queenbee:bounded-node`",
		"`npm.cmd run verify:queenbee:jsts:rename`",
		"`npm.cmd run verify:queenbee:jsts:file-and-test`",
		"`npm.cmd run verify:queenbee:engine-flag`",
		"`npm.cmd run verify:queenbee:ux`",
		"`npm.cmd run verify:queenbee:beta-gate`",
	])
	const sixFamilySetExplicit =
		includesAll(betaGateText, [
			"`comment_file`",
			"`update_named_file`",
			"`bounded_two_file_update`",
			"`update_file_and_test`",
			"`rename_export`",
			"`bounded_node_cli_task`",
		]) &&
		includesAll(firstSliceText, [
			"## Session 207 Widened Beta Target",
			"the current live candidate shell now includes all six families",
			"`bounded_node_cli_task`",
		])
	const readmeGateAligned = includesAll(readmeText, [
		"Session 207 widening:",
		"Session 212 bounded beta polish:",
		"Session 214 export gate:",
		"`QUEENBEE_BETA_GATE.md`",
		"`swarmengine` stays the shipped bounded engine and `queenbee` stays experimental",
	])
	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:beta-gate`",
		"final bounded QueenBee beta gate",
		"shipped `swarmengine` boundary",
		"default-engine claim",
	])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 214 records one explicit fresh-repo export gate and bounded QueenBee beta answer",
		"**Session:** 214",
		"bounded QueenBee beta answer",
		"`swarmengine` remains the shipped bounded engine and `queenbee` remains experimental",
	])
	const capabilityChecklistAligned = includesAll(capabilityText, [
		"Is the current `Queenshift` public-export answer now a fresh curated repo handoff while `queenbee` stays an experimental bounded beta?",
		"`QUEENBEE_BETA_GATE.md`",
		"`npm.cmd run verify:queenbee:beta-gate`",
		"experimental bounded beta",
	])

	details.push(
		`sixFamilySetExplicit=${sixFamilySetExplicit ? "yes" : "no"}`,
		`proofBundleExplicit=${proofBundleExplicit ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		betaGateDocPresent,
		proofBundleExplicit,
		sixFamilySetExplicit,
		readmeGateAligned,
		verificationCatalogAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		details,
	}
}

export function formatQueenBeeBetaGateHarnessResult(result: QueenBeeBetaGateHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Beta gate doc present: ${result.betaGateDocPresent ? "PASS" : "FAIL"}`,
		`Proof bundle explicit: ${result.proofBundleExplicit ? "PASS" : "FAIL"}`,
		`Six-family set explicit: ${result.sixFamilySetExplicit ? "PASS" : "FAIL"}`,
		`Readme gate aligned: ${result.readmeGateAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeBetaGateHarness()
	console.log(formatQueenBeeBetaGateHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.betaGateDocPresent &&
			result.proofBundleExplicit &&
			result.sixFamilySetExplicit &&
			result.readmeGateAligned &&
			result.verificationCatalogAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:beta-gate] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
