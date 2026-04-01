import fs from "node:fs"
import path from "node:path"

export type QueenBeeTraceabilityHarnessResult = {
	packageScriptPresent: boolean
	traceabilityMatrixPresent: boolean
	requirementsSourceAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeTraceabilityHarness(rootDir = resolveRootDir()): Promise<QueenBeeTraceabilityHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const usabilityRequirementsText = readText(rootDir, "QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:traceability"] === "npm run build && node dist/verification/verify_queenbee_traceability.js"

	const traceabilityMatrixPresent = includesAll(traceabilityText, [
		"# QueenBee Requirements Traceability Matrix",
		"support claims should trace from user scenario to primitive to bee to proof",
		"`QB-PUR-01`",
		"`QB-PUR-10`",
		"`QB-TR-01`",
		"`QB-TR-06`",
		"`QB-TR-07`",
		"`QB-TR-11`",
		"`comment_file`",
		"`bounded_node_cli_task`",
		"`create_tiny_file`",
		"rows marked `DEFER` or `REFUSE` do not widen the public claim",
	])

	const requirementsSourceAligned = includesAll(usabilityRequirementsText, [
		"# QueenBee Public Usability Requirements",
		"`QB-PUR-01`",
		"`QB-PUR-10`",
		"later primitive, envelope, interface, allocation, eval, and expansion docs should map their rows back to these IDs",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 218 makes allocation, identity, and support traceability explicit before failure and evaluation widening",
		"**Session:** 218",
		"`QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md`",
		"`npm.cmd run verify:queenbee:traceability`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B24 |",
		"`QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md`",
		"`npm.cmd run verify:queenbee:traceability`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:traceability`",
		"requirements traceability matrix",
		"user scenario to primitive to bee to proof",
	])

	details.push(
		`traceabilityMatrixPresent=${traceabilityMatrixPresent ? "yes" : "no"}`,
		`requirementsSourceAligned=${requirementsSourceAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		traceabilityMatrixPresent,
		requirementsSourceAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeTraceabilityHarnessResult(result: QueenBeeTraceabilityHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Traceability matrix present: ${result.traceabilityMatrixPresent ? "PASS" : "FAIL"}`,
		`Requirements source aligned: ${result.requirementsSourceAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeTraceabilityHarness()
	console.log(formatQueenBeeTraceabilityHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.traceabilityMatrixPresent &&
			result.requirementsSourceAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:traceability] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
