import fs from "node:fs"
import path from "node:path"

export type QueenBeeIdentityHarnessResult = {
	packageScriptPresent: boolean
	identityDocPresent: boolean
	capabilityRegistryAligned: boolean
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

export async function runQueenBeeIdentityHarness(rootDir = resolveRootDir()): Promise<QueenBeeIdentityHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const identityDocText = readText(rootDir, "QUEENBEE_IDENTITY_AND_TAGGING.md")
	const capabilityRegistryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:identity"] === "npm run build && node dist/verification/verify_queenbee_identity.js"

	const identityDocPresent = includesAll(identityDocText, [
		"# QueenBee Identity And Tagging",
		"`queenbee.queen.001`",
		"`queenbee.jsts_coder.001`",
		"`missionId`",
		"`assignmentId`",
		"`scopeToken`",
		"`toolGrantToken`",
		"`queueItemId`",
		"`sliceTag`",
		"`reservationTag`",
		"`progressTag`",
		"Derived tags are not new `qb-v1` packet keys.",
		"no live clone-worker pool exists yet",
	])

	const capabilityRegistryAligned = includesAll(capabilityRegistryText, [
		"## Session 218 Allocation And Identity Alignment",
		"`QUEENBEE_IDENTITY_AND_TAGGING.md`",
		"future clone-candidate worker ids require an explicit parent family, `sliceTag`, and `queueItemId`",
		"`currentAssignmentId` stays the reservation truth anchor",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 218 makes allocation, identity, and support traceability explicit before failure and evaluation widening",
		"**Session:** 218",
		"`QUEENBEE_IDENTITY_AND_TAGGING.md`",
		"`npm.cmd run verify:queenbee:identity`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B24 |",
		"`QUEENBEE_IDENTITY_AND_TAGGING.md`",
		"`npm.cmd run verify:queenbee:identity`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:identity`",
		"identity and tagging",
		"mission, assignment, slice, reservation, and queue identity",
	])

	details.push(
		`identityDocPresent=${identityDocPresent ? "yes" : "no"}`,
		`capabilityRegistryAligned=${capabilityRegistryAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		identityDocPresent,
		capabilityRegistryAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeIdentityHarnessResult(result: QueenBeeIdentityHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Identity doc present: ${result.identityDocPresent ? "PASS" : "FAIL"}`,
		`Capability registry aligned: ${result.capabilityRegistryAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeIdentityHarness()
	console.log(formatQueenBeeIdentityHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.identityDocPresent &&
			result.capabilityRegistryAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:identity] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
