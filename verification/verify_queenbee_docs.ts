import fs from "node:fs"
import path from "node:path"

export type QueenBeeDocsHarnessResult = {
	readmeCandidateBoundaryAligned: boolean
	readmeRoadmapAligned: boolean
	candidateFreezeContractPresent: boolean
	firstSliceFreezeContractPresent: boolean
	architectureFreezeDecisionRecorded: boolean
	verificationCatalogAligned: boolean
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

export async function runQueenBeeDocsHarness(rootDir = resolveRootDir()): Promise<QueenBeeDocsHarnessResult> {
	const details: string[] = []

	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const candidateText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")

	const readmeEngineSection = extractSection(readmeText, "Engine Names And Experimental Direction")
	const readmeCandidateBoundaryAligned = includesAll(readmeEngineSection, [
		"`swarmengine`",
		"`queenbee`",
		"not part of the current public product claim",
		"`qb-v1`",
		"verify:queenbee:docs",
		"verify:queenbee:protocol",
	])
	const readmeRoadmapAligned = readmeText.includes("Roadmap_Sessions203-214.md") && !readmeText.includes("Roadmap_Sessions107-142.md")
	const candidateFreezeContractPresent = includesAll(candidateText, [
		"## Protocol Freeze Contract",
		"`qb-v1`",
		"## Frozen Candidate Boundaries",
		"## Change Control",
		"verify:queenbee:docs",
		"verify:queenbee:protocol",
	])
	const firstSliceFreezeContractPresent = includesAll(firstSliceText, [
		"## Frozen Slice Contract",
		"`qb-v1`",
		"## Supported Bring-Up Order",
		"## Phase-Gated Activation",
		"`swarmengine` stays the shipped default",
	])
	const architectureFreezeDecisionRecorded = includesAll(architectureText, [
		"## Decision: QueenBee `qb-v1` is a doc-first frozen contract before runtime scaffolding",
		"**Session:** 183",
		"`swarmengine`",
		"`queenbee`",
		"proof wrappers",
	])
	const verificationCatalogAligned = includesAll(verificationCatalogText, [
		"## QueenBee Candidate Guardrail Proofs",
		"verify:queenbee:docs",
		"verify:queenbee:beta-contract",
		"verify:queenbee:protocol",
		"`swarmengine` still stays the shipped default",
		"`qb-v1` candidate docs stay aligned",
	])

	details.push(
		`readmeEngineSection=${readmeEngineSection ? "present" : "missing"}`,
		`candidateFreezeContract=${candidateFreezeContractPresent ? "present" : "missing"}`,
		`firstSliceFreezeContract=${firstSliceFreezeContractPresent ? "present" : "missing"}`,
		`verificationCatalogQueenBee=${verificationCatalogAligned ? "aligned" : "missing"}`,
	)

	return {
		readmeCandidateBoundaryAligned,
		readmeRoadmapAligned,
		candidateFreezeContractPresent,
		firstSliceFreezeContractPresent,
		architectureFreezeDecisionRecorded,
		verificationCatalogAligned,
		details,
	}
}

export function formatQueenBeeDocsHarnessResult(result: QueenBeeDocsHarnessResult): string {
	return [
		`Readme candidate boundary aligned: ${result.readmeCandidateBoundaryAligned ? "PASS" : "FAIL"}`,
		`Readme roadmap aligned: ${result.readmeRoadmapAligned ? "PASS" : "FAIL"}`,
		`Candidate freeze contract present: ${result.candidateFreezeContractPresent ? "PASS" : "FAIL"}`,
		`First-slice freeze contract present: ${result.firstSliceFreezeContractPresent ? "PASS" : "FAIL"}`,
		`Architecture freeze decision recorded: ${result.architectureFreezeDecisionRecorded ? "PASS" : "FAIL"}`,
		`Verification catalog aligned: ${result.verificationCatalogAligned ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeDocsHarness()
	console.log(formatQueenBeeDocsHarnessResult(result))
	process.exit(
		result.readmeCandidateBoundaryAligned &&
			result.readmeRoadmapAligned &&
			result.candidateFreezeContractPresent &&
			result.firstSliceFreezeContractPresent &&
			result.architectureFreezeDecisionRecorded &&
			result.verificationCatalogAligned
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:docs] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
