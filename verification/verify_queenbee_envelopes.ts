import fs from "node:fs"
import path from "node:path"

export type QueenBeeEnvelopesHarnessResult = {
	packageScriptPresent: boolean
	operatingEnvelopesPresent: boolean
	toolGrantAlignmentPresent: boolean
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

export async function runQueenBeeEnvelopesHarness(rootDir = resolveRootDir()): Promise<QueenBeeEnvelopesHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const operatingEnvelopesText = readText(rootDir, "QUEENBEE_BEE_OPERATING_ENVELOPES.md")
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:envelopes"] === "npm run build && node dist/verification/verify_queenbee_envelopes.js"

	const operatingEnvelopesPresent = includesAll(operatingEnvelopesText, [
		"# QueenBee Bee Operating Envelopes",
		"`scopeToken` and `toolGrantToken` narrow authority further",
		"`admission_checked`",
		"`proposal_ready`",
		"`merge_ready`",
		"`QueenBee`",
		"`RouterBee`",
		"`RegistryBee`",
		"`SafetyBee`",
		"`ScoutBee`",
		"`PlannerBee`",
		"`JSTSCoderBee`",
		"`JSTSReviewerBee`",
		"`VerifierBee`",
		"`MergeBee`",
		"`ArchivistBee`",
		"`RecoveryBee`",
		"fixed control bees keep one stationary identity",
		"clone-candidate worker families still run as one live slot",
	])

	const toolGrantAlignmentPresent = includesAll(toolGrantsText, [
		"## Session 217 Envelope Alignment",
		"`QUEENBEE_BEE_OPERATING_ENVELOPES.md`",
		"`scopeToken` and `toolGrantToken` narrow authority further",
		"fixed control bees stay singletons",
		"`MergeBee` remains the only merge authority and `RouterBee` remains message-only",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 217 keeps the control spine fixed and records envelopes, interfaces, and deterministic fan-in",
		"**Session:** 217",
		"`QUEENBEE_BEE_OPERATING_ENVELOPES.md`",
		"`npm.cmd run verify:queenbee:envelopes`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B23 |",
		"`QUEENBEE_BEE_OPERATING_ENVELOPES.md`",
		"`npm.cmd run verify:queenbee:envelopes`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:envelopes`",
		"bee operating envelopes",
		"what each bee may touch, emit, and refuse",
	])

	details.push(
		`operatingEnvelopesPresent=${operatingEnvelopesPresent ? "yes" : "no"}`,
		`toolGrantAlignmentPresent=${toolGrantAlignmentPresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		operatingEnvelopesPresent,
		toolGrantAlignmentPresent,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeEnvelopesHarnessResult(result: QueenBeeEnvelopesHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Operating envelopes present: ${result.operatingEnvelopesPresent ? "PASS" : "FAIL"}`,
		`Tool-grant alignment present: ${result.toolGrantAlignmentPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeEnvelopesHarness()
	console.log(formatQueenBeeEnvelopesHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.operatingEnvelopesPresent &&
			result.toolGrantAlignmentPresent &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:envelopes] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
