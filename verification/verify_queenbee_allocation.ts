import fs from "node:fs"
import path from "node:path"

export type QueenBeeAllocationHarnessResult = {
	packageScriptPresent: boolean
	allocationPolicyPresent: boolean
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

export async function runQueenBeeAllocationHarness(rootDir = resolveRootDir()): Promise<QueenBeeAllocationHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const allocationPolicyText = readText(rootDir, "QUEENBEE_ALLOCATION_POLICY.md")
	const capabilityRegistryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:allocation"] === "npm run build && node dist/verification/verify_queenbee_allocation.js"

	const allocationPolicyPresent = includesAll(allocationPolicyText, [
		"# QueenBee Allocation Policy",
		"allocation must fail closed unless the task family, file envelope, primitive stack, bee route, and proof bundle all map cleanly",
		"`queenbee.jsts_coder.001`",
		"`comment_file`",
		"`bounded_two_file_update`",
		"`update_file_and_test`",
		"`rename_export`",
		"`bounded_node_cli_task`",
		"`create_tiny_file`",
		"`JSTSCoreBee`",
		"`JSTSAsyncBee`",
		"`JSTSNodeBee`",
		"support claims become traceable and reviewable",
	])

	const capabilityRegistryAligned = includesAll(capabilityRegistryText, [
		"## Session 218 Allocation And Identity Alignment",
		"`QUEENBEE_ALLOCATION_POLICY.md`",
		"`QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md`",
		"`currentAssignmentId` stays the reservation truth anchor",
		"no clone row is registry-valid",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 218 makes allocation, identity, and support traceability explicit before failure and evaluation widening",
		"**Session:** 218",
		"`QUEENBEE_ALLOCATION_POLICY.md`",
		"`npm.cmd run verify:queenbee:allocation`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B24 |",
		"`QUEENBEE_ALLOCATION_POLICY.md`",
		"`npm.cmd run verify:queenbee:allocation`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:allocation`",
		"allocation policy",
		"task-to-bee selection",
		"fail-closed support claims",
	])

	details.push(
		`allocationPolicyPresent=${allocationPolicyPresent ? "yes" : "no"}`,
		`capabilityRegistryAligned=${capabilityRegistryAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		allocationPolicyPresent,
		capabilityRegistryAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeAllocationHarnessResult(result: QueenBeeAllocationHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Allocation policy present: ${result.allocationPolicyPresent ? "PASS" : "FAIL"}`,
		`Capability registry aligned: ${result.capabilityRegistryAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeAllocationHarness()
	console.log(formatQueenBeeAllocationHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.allocationPolicyPresent &&
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
		console.error(`[verify:queenbee:allocation] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
