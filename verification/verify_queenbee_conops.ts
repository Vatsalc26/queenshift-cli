import fs from "node:fs"
import path from "node:path"

export type QueenBeeConopsHarnessResult = {
	packageScriptPresent: boolean
	candidateControlFoundationPresent: boolean
	conopsDocPresent: boolean
	publicUsabilityDocPresent: boolean
	architectureDecisionRecorded: boolean
	capabilityChecklistAligned: boolean
	verificationCatalogAligned: boolean
	sessionProtocolAligned: boolean
	codingAgentProtocolAligned: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function readText(rootDir: string, relativePath: string): string {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8")
}

function extractSection(text: string, heading: string): string {
	const headingPattern = new RegExp(`^## ${escapeRegExp(heading)}\\b.*$`, "m")
	const headingMatch = headingPattern.exec(text)
	if (!headingMatch || typeof headingMatch.index !== "number") return ""

	const sectionStart = headingMatch.index
	const afterHeading = text.slice(sectionStart)
	const remainder = afterHeading.slice(headingMatch[0].length)
	const nextHeadingIndex = remainder.search(/\n##\s/u)
	if (nextHeadingIndex === -1) return afterHeading.trimEnd()
	return afterHeading.slice(0, headingMatch[0].length + nextHeadingIndex).trimEnd()
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

export async function runQueenBeeConopsHarness(rootDir = resolveRootDir()): Promise<QueenBeeConopsHarnessResult> {
	const details: string[] = []

	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const conopsText = readText(rootDir, "QUEENBEE_CONOPS.md")
	const publicUsabilityText = readText(rootDir, "QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const capabilityChecklistText = readText(rootDir, "SWARM_CAPABILITY_CHECKLIST.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const sessionProtocolText = readText(rootDir, "Coding_sessions/START_HERE_SESSION_PROTOCOL.md")
	const codingAgentProtocolText = readText(rootDir, "CODING_AGENT_PROTOCOL.md")

	const packageScriptPresent =
		packageJson.scripts?.["verify:queenbee:conops"] === "npm run build && node dist/verification/verify_queenbee_conops.js"

	const controlFoundationSection = extractSection(candidateText, "Session 215 Control Stack Foundation")
	const candidateControlFoundationPresent = includesAll(controlFoundationSection, [
		"Coding_sessions/Roadmap_Sessions215-226.md",
		"`QUEENBEE_CONOPS.md`",
		"`QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md`",
		"no lock-in",
		"low friction",
		"`npm.cmd run verify:queenbee:conops`",
	])

	const conopsDocPresent =
		includesAll(conopsText, [
			"# QueenBee ConOps",
			"## Current Truth Boundary",
			"`swarmengine` remains the shipped bounded engine",
			"`queenbee` remains experimental",
			"`comment_file`",
			"`bounded_node_cli_task`",
			"## Control Stack Layers",
			"## Reverse-Engineering Loop",
			"## Artifact And Confidence Model",
			"## Refusal And Expansion Discipline",
			"`QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md`",
		]) &&
		includesAll(conopsText, [
			"side-by-side example packs are required",
			"bounded success, bounded refusal, or bounded quarantine and recovery",
			"living source-of-truth docs for Sessions `215-226`",
		])

	const publicUsabilityDocPresent =
		includesAll(publicUsabilityText, [
			"# QueenBee Public Usability Requirements",
			"## Stable Requirement IDs",
			"`QB-PUR-01`",
			"`QB-PUR-05`",
			"`QB-PUR-06`",
			"`QB-PUR-08`",
			"`QB-PUR-09`",
			"no lock-in",
			"low friction",
			"artifacts",
			"side-by-side examples",
			"bounded limits",
			"refusal",
			"`npm.cmd run verify:queenbee:conops`",
		]) &&
		includesAll(publicUsabilityText, [
			"control-stack commitments, not automatic claim-green signals",
			"`swarmengine` remains shipped and `queenbee` remains experimental",
		])

	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 215 adds an explicit QueenBee ConOps and public usability contract before more widening",
		"**Session:** 215",
		"`QUEENBEE_CONOPS.md`",
		"`QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md`",
		"`swarmengine` truth",
	])

	const capabilityChecklistAligned = includesAll(capabilityChecklistText, [
		"| B21 |",
		"`QUEENBEE_CONOPS.md`",
		"`QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md`",
		"`npm.cmd run verify:queenbee:conops`",
		"no lock-in, low friction, artifacts, side-by-side examples, visible limits, and refusal",
	])

	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"`npm.cmd run verify:queenbee:conops`",
		"bounded ConOps plus one public usability contract",
		"no lock-in",
		"low friction",
		"side-by-side examples",
	])

	const sessionProtocolAligned = includesAll(sessionProtocolText, [
		"`QUEENBEE_CONOPS.md`",
		"`QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md`",
		"candidate ConOps, public usability requirements",
	])

	const codingAgentProtocolAligned = includesAll(codingAgentProtocolText, [
		"candidate ConOps, public usability requirements",
		"`QUEENBEE_*.md` docs and `ARCHITECTURE_DECISIONS.md`",
	])

	details.push(
		`controlFoundationSection=${controlFoundationSection ? "present" : "missing"}`,
		`conopsHeadingsPresent=${conopsDocPresent ? "yes" : "no"}`,
		`publicUsabilityPresent=${publicUsabilityDocPresent ? "yes" : "no"}`,
		`sessionProtocolConopsListed=${sessionProtocolAligned ? "yes" : "no"}`,
		`codingAgentProtocolConopsListed=${codingAgentProtocolAligned ? "yes" : "no"}`,
	)

	return {
		packageScriptPresent,
		candidateControlFoundationPresent,
		conopsDocPresent,
		publicUsabilityDocPresent,
		architectureDecisionRecorded,
		capabilityChecklistAligned,
		verificationCatalogAligned,
		sessionProtocolAligned,
		codingAgentProtocolAligned,
		details,
	}
}

export function formatQueenBeeConopsHarnessResult(result: QueenBeeConopsHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Candidate control foundation present: ${result.candidateControlFoundationPresent ? "PASS" : "FAIL"}`,
		`ConOps doc present: ${result.conopsDocPresent ? "PASS" : "FAIL"}`,
		`Public usability doc present: ${result.publicUsabilityDocPresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		`Capability checklist aligned: ${result.capabilityChecklistAligned ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		`Session protocol aligned: ${result.sessionProtocolAligned ? "PASS" : "FAIL"}`,
		`Coding agent protocol aligned: ${result.codingAgentProtocolAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeConopsHarness()
	console.log(formatQueenBeeConopsHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.candidateControlFoundationPresent &&
			result.conopsDocPresent &&
			result.publicUsabilityDocPresent &&
			result.architectureDecisionRecorded &&
			result.capabilityChecklistAligned &&
			result.verificationCatalogAligned &&
			result.sessionProtocolAligned &&
			result.codingAgentProtocolAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:conops] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
