import fs from "node:fs"
import path from "node:path"

export type QueenBeeControlStackHarnessResult = {
	packageScriptPresent: boolean
	gateDocPresent: boolean
	supportMatrixExplicit: boolean
	nextBandAnswerExplicit: boolean
	singletonAndCloneAnswerExplicit: boolean
	controlStackAnchorsPreserved: boolean
	traceabilityAligned: boolean
	gapRegisterAligned: boolean
	reverseEngineeringAligned: boolean
	parallelModelAligned: boolean
	architectureDecisionRecorded: boolean
	verificationCatalogAligned: boolean
	capabilityChecklistAligned: boolean
	betaBoundaryPreserved: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function readText(rootDir: string, relativePath: string): string {
	const absolutePath = path.join(rootDir, relativePath)
	return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : ""
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeControlStackHarness(rootDir = resolveRootDir()): Promise<QueenBeeControlStackHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const gateText = readText(rootDir, "QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md")
	const reverseEngineeringText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const betaGateText = readText(rootDir, "QUEENBEE_BETA_GATE.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const beeClassificationText = readText(rootDir, "QUEENBEE_BEE_CLASSIFICATION.md")
	const identityText = readText(rootDir, "QUEENBEE_IDENTITY_AND_TAGGING.md")
	const toolGrantText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const progressVisibilityText = readText(rootDir, "QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:control-stack"] ===
		"npm run build && node dist/verification/verify_queenbee_control_stack.js"

	const gateDocPresent = includesAll(gateText, [
		"# QueenBee Proportional Expansion Gate",
		"This is an internal control-stack gate, not a public beta-widening claim.",
		"Current gate answer: `SERIOUS_BOUNDED_DAILY_JSTS_SURFACE`",
		"On `2026-04-01`, QueenBee has five provider-backed canonical live rows, one provider-backed gateway live row, one fixed six-row daily JS/TS corpus with acceptance fixtures",
		"`swarmengine` remains the shipped bounded engine",
		"`queenbee` remains experimental",
	])

	const supportMatrixExplicit = includesAll(gateText, [
		"| `QB-CAN-01` | `SUPPORTED` |",
		"| `QB-CAN-02` | `SUPPORTED` |",
		"| `QB-CAN-03` | `SUPPORTED` |",
		"| `QB-CAN-04` | `SUPPORTED` |",
		"| `QB-CAN-05` | `SUPPORTED` |",
		"| `QB-CAN-06` | `SUPPORTED` |",
		"| `QB-CAN-07` | `SUPPORTED` |",
	])

	const nextBandAnswerExplicit = includesAll(gateText, [
		"same-assignment clone workers remain `DEFER`",
		"`sliceTag`",
		"deterministic RouterBee fan-in",
		"new outer specialist route slots remain `DEFER`",
		"`create_tiny_file` is now internally `SUPPORTED`",
		"Phase C may begin, but only inside the same bounded envelope",
	])

	const singletonAndCloneAnswerExplicit = includesAll(gateText, [
		"`fixed_control_bees`",
		"`KEEP_SINGLETON`",
		"`outer_specialist_slots`",
		"`queenbee.jsts_coder.001`, `queenbee.jsts_reviewer.001`, and `queenbee.verifier.001`",
		"`inner_specialist_selection`",
		"`KEEP_SELECTOR_ONLY`",
		"`JSTSCoreBee`, `JSTSAsyncBee`, `JSTSTestBee`, `JSTSRefactorBee`, and `JSTSNodeBee`",
		"`same_assignment_clone_workers`",
		"`logical_queues`",
		"`KEEP_CURRENT_MODEL`",
		"`checkpoint_ladder`",
	])

	const controlStackAnchorsPreserved =
		includesAll(gateText, [
			"thinking-versus-deterministic classification remains governed by `QUEENBEE_BEE_CLASSIFICATION.md`",
			"identity and tagging remain governed by `QUEENBEE_IDENTITY_AND_TAGGING.md`",
			"bounded tool grants remain deny-by-default under `QUEENBEE_TOOL_GRANTS.md`",
			"visible swarm progress remains governed by `QUEENBEE_PROGRESS_VISIBILITY_CONTRACT.md`",
		]) &&
		includesAll(beeClassificationText, ["`thinking`", "`deterministic`", "`fixed_control`", "`specialist_worker`", "`clone_candidate_later`"]) &&
		includesAll(identityText, ["`missionId`", "`assignmentId`", "`sliceTag`", "`progressTag`"]) &&
		includesAll(toolGrantText, ["grants are deny-by-default", "`VerifierBee` runs only the named proof commands", "Do not grant"]) &&
		includesAll(progressVisibilityText, [
			"progress must stay visible",
			"active queue name",
			"`missionId`",
			"`assignmentId`",
			"next expected handoff or stop reason",
		])

	const traceabilityAligned = includesAll(traceabilityText, [
		"| `QB-TR-07` | `create_tiny_file` | `SUPPORTED` |",
		"| `QB-TR-12` | `same_assignment_clone_worker_slice` | `DEFER` |",
		"`sliceTag`",
		"do not claim same-assignment clone workers until a later roadmap proves slice ownership and deterministic fan-in explicitly",
	])

	const gapRegisterAligned = includesAll(gapRegisterText, [
		"`QB-GAP-226-01`",
		"`OPEN_DEFER`",
		"`QB-GAP-226-02`",
		"`CLOSED_SESSION_226`",
		"## Session 226 Reading",
	])

	const reverseEngineeringAligned = includesAll(reverseEngineeringText, [
		"## Session 226 Proportional Expansion Answer",
		"seven internal canonical rows are now explicitly `SUPPORTED`",
		"`create_tiny_file` is now internally `SUPPORTED`",
		"the current control spine and outer specialist slots remain singleton",
	])

	const parallelModelAligned = includesAll(parallelModelText, [
		"## Session 226 Expansion Gate Reading",
		"the control spine and outer specialist slots remain singleton for the next band",
		"same-assignment clone workers stay deferred",
		"the current logical queues and checkpoint ladder are enough for the supported rows",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 226 closes the reverse-engineering band with a targeted next-band gate instead of momentum widening",
		"**Session:** 226",
		"`QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md`",
		"`verify:queenbee:control-stack`",
		"keep bee classification, identity/tagging, tool-grant, and progress contracts authoritative",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"49. `npm.cmd run verify:queenbee:control-stack`",
		"51. the Session 226 proportional expansion answer now records the next-band gate, and later sessions keep same-assignment clone workers deferred while the public beta boundary remains frozen",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B32 |",
		"`QUEENBEE_PROPORTIONAL_EXPANSION_GATE.md`",
		"`npm.cmd run verify:queenbee:control-stack`",
		"same-assignment clone workers stay deferred",
	])

	const betaBoundaryPreserved =
		includesAll(betaGateText, [
			"Current gate answer: `EXPERIMENTAL_BETA_OK`",
			"`swarmengine` remains the shipped bounded engine",
			"`queenbee` remains experimental",
		]) &&
		includesAll(gateText, [
			"no public claim widening beyond the six explicit bounded beta families is justified by this gate",
			"no default-engine switch, hidden clone pool, broad autonomy, or cross-tool claim is justified by this gate",
		])

	details.push(
		`supportMatrixExplicit=${supportMatrixExplicit ? "yes" : "no"}`,
		`controlStackAnchorsPreserved=${controlStackAnchorsPreserved ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		gateDocPresent,
		supportMatrixExplicit,
		nextBandAnswerExplicit,
		singletonAndCloneAnswerExplicit,
		controlStackAnchorsPreserved,
		traceabilityAligned,
		gapRegisterAligned,
		reverseEngineeringAligned,
		parallelModelAligned,
		architectureDecisionRecorded,
		verificationCatalogAligned,
		capabilityChecklistAligned,
		betaBoundaryPreserved,
		details,
	}
}

export function formatQueenBeeControlStackHarnessResult(result: QueenBeeControlStackHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Gate doc present: ${result.gateDocPresent ? "PASS" : "FAIL"}`,
		`Support matrix explicit: ${result.supportMatrixExplicit ? "PASS" : "FAIL"}`,
		`Next-band answer explicit: ${result.nextBandAnswerExplicit ? "PASS" : "FAIL"}`,
		`Singleton and clone answer explicit: ${result.singletonAndCloneAnswerExplicit ? "PASS" : "FAIL"}`,
		`Control-stack anchors preserved: ${result.controlStackAnchorsPreserved ? "PASS" : "FAIL"}`,
		`Traceability aligned: ${result.traceabilityAligned ? "PASS" : "FAIL"}`,
		`Gap register aligned: ${result.gapRegisterAligned ? "PASS" : "FAIL"}`,
		`Reverse-engineering aligned: ${result.reverseEngineeringAligned ? "PASS" : "FAIL"}`,
		`Parallel model aligned: ${result.parallelModelAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Beta boundary preserved: ${result.betaBoundaryPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeControlStackHarness()
	console.log(formatQueenBeeControlStackHarnessResult(result))
	process.exit(
			result.packageScriptPresent &&
			result.gateDocPresent &&
			result.supportMatrixExplicit &&
			result.nextBandAnswerExplicit &&
			result.singletonAndCloneAnswerExplicit &&
			result.controlStackAnchorsPreserved &&
			result.traceabilityAligned &&
			result.gapRegisterAligned &&
			result.reverseEngineeringAligned &&
			result.parallelModelAligned &&
			result.architectureDecisionRecorded &&
			result.verificationCatalogAligned &&
			result.capabilityChecklistAligned &&
			result.betaBoundaryPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:control-stack] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
