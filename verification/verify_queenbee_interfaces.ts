import fs from "node:fs"
import path from "node:path"

export type QueenBeeInterfacesHarnessResult = {
	packageScriptPresent: boolean
	interfaceControlPresent: boolean
	protocolMapAligned: boolean
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

export async function runQueenBeeInterfacesHarness(rootDir = resolveRootDir()): Promise<QueenBeeInterfacesHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const interfaceControlText = readText(rootDir, "QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const toolGrantsText = readText(rootDir, "QUEENBEE_TOOL_GRANTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:interfaces"] === "npm run build && node dist/verification/verify_queenbee_interfaces.js"

	const interfaceControlPresent = includesAll(interfaceControlText, [
		"# QueenBee Interface Control Document",
		"`QB-IF-01`",
		"`QB-IF-05`",
		"`QB-IF-10`",
		"`assignmentId`",
		"`scopeToken`",
		"`toolGrantToken`",
		"`recipient_runtime_unavailable`",
		"`RouterBee <-> RegistryBee`",
		"`RouterBee <-> JSTSCoderBee`",
		"`JSTSCoderBee -> RouterBee -> JSTSReviewerBee`",
		"`VerifierBee -> RouterBee -> MergeBee`",
		"`AnyBee failure -> RouterBee -> RecoveryBee`",
	])

	const protocolMapAligned = includesAll(protocolMapText, [
		"## Session 217 Envelope And Interface Alignment",
		"`QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md`",
	])

	const toolGrantAlignmentPresent = includesAll(toolGrantsText, [
		"## Session 217 Envelope Alignment",
		"`QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md` makes that handshake explicit",
		"`MergeBee` remains the only merge authority and `RouterBee` remains message-only",
	])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 217 keeps the control spine fixed and records envelopes, interfaces, and deterministic fan-in",
		"**Session:** 217",
		"`QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md`",
		"`npm.cmd run verify:queenbee:interfaces`",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B23 |",
		"`QUEENBEE_INTERFACE_CONTROL_DOCUMENT.md`",
		"`npm.cmd run verify:queenbee:interfaces`",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:interfaces`",
		"interface control doc",
		"route-bound handshakes",
		"fail-closed interface rules",
	])

	details.push(
		`interfaceControlPresent=${interfaceControlPresent ? "yes" : "no"}`,
		`toolGrantAlignmentPresent=${toolGrantAlignmentPresent ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		interfaceControlPresent,
		protocolMapAligned,
		toolGrantAlignmentPresent,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeInterfacesHarnessResult(result: QueenBeeInterfacesHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Interface control present: ${result.interfaceControlPresent ? "PASS" : "FAIL"}`,
		`Protocol map aligned: ${result.protocolMapAligned ? "PASS" : "FAIL"}`,
		`Tool-grant alignment present: ${result.toolGrantAlignmentPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeInterfacesHarness()
	console.log(formatQueenBeeInterfacesHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.interfaceControlPresent &&
			result.protocolMapAligned &&
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
		console.error(`[verify:queenbee:interfaces] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
