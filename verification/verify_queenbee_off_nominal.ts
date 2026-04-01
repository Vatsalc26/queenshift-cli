import fs from "node:fs"
import path from "node:path"

export type QueenBeeOffNominalHarnessResult = {
	packageScriptPresent: boolean
	offNominalDocPresent: boolean
	failureRulesAligned: boolean
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

export async function runQueenBeeOffNominalHarness(rootDir = resolveRootDir()): Promise<QueenBeeOffNominalHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const offNominalText = readText(rootDir, "QUEENBEE_OFF_NOMINAL_SCENARIOS.md")
	const failureRulesText = readText(rootDir, "QUEENBEE_FAILURE_AND_QUARANTINE_RULES.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:off-nominal"] === "npm run build && node dist/verification/verify_queenbee_off_nominal.js"

	const offNominalDocPresent = includesAll(offNominalText, [
		"# QueenBee Off-Nominal Scenarios",
		"`QB-ON-01`",
		"`QB-ON-06`",
		"`QB-ON-12`",
		"`RecoveryBee`",
		"`cooling_off`",
		"`quarantined`",
		"`red_lane_interruption`",
		"hidden retry",
	])

	const failureRulesAligned = includesAll(failureRulesText, [
		"# QueenBee Failure And Quarantine Rules",
		"`provider_failure`",
		"`review_failure`",
		"`merge_failure`",
		"`RecoveryBee` should:",
		"create a red-lane fix session",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 219 makes failure behavior, queue truth, and operator confidence explicit before evaluation work",
		"**Session:** 219",
		"`QUEENBEE_OFF_NOMINAL_SCENARIOS.md`",
		"`npm.cmd run verify:queenbee:off-nominal`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B25 |",
		"`QUEENBEE_OFF_NOMINAL_SCENARIOS.md`",
		"`npm.cmd run verify:queenbee:off-nominal`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:off-nominal`",
		"off-nominal scenarios",
		"failure behavior",
		"red-lane interruption",
	])

	details.push(
		`offNominalDocPresent=${offNominalDocPresent ? "yes" : "no"}`,
		`failureRulesAligned=${failureRulesAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		offNominalDocPresent,
		failureRulesAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeOffNominalHarnessResult(result: QueenBeeOffNominalHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Off-nominal doc present: ${result.offNominalDocPresent ? "PASS" : "FAIL"}`,
		`Failure rules aligned: ${result.failureRulesAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeOffNominalHarness()
	console.log(formatQueenBeeOffNominalHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.offNominalDocPresent &&
			result.failureRulesAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:off-nominal] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
