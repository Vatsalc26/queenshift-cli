import fs from "node:fs"
import path from "node:path"

export type QueenBeeParallelModelHarnessResult = {
	packageScriptPresent: boolean
	parallelModelPresent: boolean
	reverseEngineeringDocsPresent: boolean
	protocolMapAligned: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	cloneGateStayedClosed: boolean
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

export async function runQueenBeeParallelModelHarness(rootDir = resolveRootDir()): Promise<QueenBeeParallelModelHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const envelopesText = readText(rootDir, "QUEENBEE_BEE_OPERATING_ENVELOPES.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:parallel-model"] === "npm run build && node dist/verification/verify_queenbee_parallel_model.js"

	const parallelModelPresent = includesAll(parallelModelText, [
		"# QueenBee Parallel Execution Model",
		"no live clone-worker pool exists yet",
		"`fixed_control_singletons`",
		"`specialist_worker_slots`",
		"`mission_ingress_queue`",
		"`service_queue`",
		"`specialist_queue`",
		"`completion_queue`",
		"## Deterministic Fan-In Rules",
		"`MergeBee` remains the single serialization point",
		"Only specialist worker families may ever become cloneable later",
		"## Progress Visibility Minimum",
	])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 225 Async, Node, And Parallel-Pressure Answer",
			"`QB-CAN-06`",
			"`QB-CAN-07`",
			"no same-assignment clone-worker fan-out need",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-225-01`",
			"`QB-GAP-225-02`",
			"`CLOSED_SESSION_225`",
		]) &&
		includesAll(envelopesText, [
			"## Session 225 Specialist Envelope Reading",
			"same-assignment clone workers remain out of envelope",
		]) &&
		includesAll(parallelModelText, [
			"## Session 225 Reverse-Engineering Reading",
			"`bounded_two_file_update` is the first row that pressures clone-worker language",
			"same-assignment multi-coder fan-out remains rejected",
		])

	const protocolMapAligned = includesAll(protocolMapText, [
		"## Session 217 Envelope And Interface Alignment",
		"`QUEENBEE_PARALLEL_EXECUTION_MODEL.md`",
		"`QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md`",
		"no new edge becomes valid just because those docs now exist",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 217 keeps the control spine fixed and records envelopes, interfaces, and deterministic fan-in",
		"**Session:** 217",
		"`QUEENBEE_PARALLEL_EXECUTION_MODEL.md`",
		"`npm.cmd run verify:queenbee:parallel-model`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B23 |",
		"`QUEENBEE_PARALLEL_EXECUTION_MODEL.md`",
		"`npm.cmd run verify:queenbee:parallel-model`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:parallel-model`",
		"fixed control spine",
		"logical queues",
		"deterministic fan-in",
	])
	const cloneGateStayedClosed =
		includesAll(parallelModelText, [
			"no live clone-worker pool exists yet",
			"same-assignment multi-coder fan-out",
			"`bounded_two_file_update` is the first row that pressures clone-worker language",
		]) &&
		includesAll(reverseEngineeringMapText, [
			"the current Session 223-225 rows stay on one live coder route slot: `queenbee.jsts_coder.001`",
			"no `sliceTag`, clone-worker, or same-assignment fan-out is justified for the Session 223-225 rows",
		])

	details.push(
		`parallelModelPresent=${parallelModelPresent ? "yes" : "no"}`,
		`protocolMapAligned=${protocolMapAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		parallelModelPresent,
		reverseEngineeringDocsPresent,
		protocolMapAligned,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		cloneGateStayedClosed,
		details,
	}
}

export function formatQueenBeeParallelModelHarnessResult(result: QueenBeeParallelModelHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Parallel model present: ${result.parallelModelPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Protocol map aligned: ${result.protocolMapAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Clone gate stayed closed: ${result.cloneGateStayedClosed ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeParallelModelHarness()
	console.log(formatQueenBeeParallelModelHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.parallelModelPresent &&
			result.reverseEngineeringDocsPresent &&
			result.protocolMapAligned &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.cloneGateStayedClosed
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:parallel-model] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
