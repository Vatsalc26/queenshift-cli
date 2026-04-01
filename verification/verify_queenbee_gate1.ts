import fs from "node:fs"
import path from "node:path"

import { runQueenBeeSmallComparisonHarness } from "./benchmark_queenbee_small"
import { runQueenBeeTwoFileComparisonHarness } from "./benchmark_queenbee_two_file"

export type QueenBeeGateOneHarnessResult = {
	comparisonProofsGreen: boolean
	gateDocPresent: boolean
	gateDocSaysHold: boolean
	blockerListPresent: boolean
	readmeBoundaryAligned: boolean
	architectureDecisionRecorded: boolean
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

export async function runQueenBeeGateOneHarness(rootDir = resolveRootDir()): Promise<QueenBeeGateOneHarnessResult> {
	const details: string[] = []
	// These harnesses both touch shared singleton and console state, so keep them serial.
	const smallResult = await runQueenBeeSmallComparisonHarness(rootDir)
	const twoFileResult = await runQueenBeeTwoFileComparisonHarness(rootDir)

	const gateDocText = readText(rootDir, "QUEENBEE_CANDIDATE_GATE_ONE.md")
	const candidateArchitectureText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const readmeText = readText(rootDir, "Readme.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const comparisonProofsGreen =
		smallResult.packageScriptPresent &&
		smallResult.comparisonDocsPresent &&
		smallResult.comparisonStayedCandidateOnly &&
		smallResult.sameTaskFamilyVisible &&
		smallResult.swarmengineTaskAdmitted &&
		smallResult.swarmengineSummaryPresent &&
		smallResult.swarmengineSmallLaneVisible &&
		smallResult.swarmengineScopeStayedBounded &&
		smallResult.swarmengineArtifactTruthVisible &&
		smallResult.queenbeeProtocolVisible &&
		smallResult.queenbeeScopeStayedBounded &&
		twoFileResult.packageScriptPresent &&
		twoFileResult.comparisonDocsPresent &&
		twoFileResult.userConfidenceReviewRecorded &&
		twoFileResult.protocolValueVsCeremonyJudged &&
		twoFileResult.sameTaskFamilyVisible &&
		twoFileResult.swarmengineTaskAdmitted &&
		twoFileResult.swarmengineSummaryPresent &&
		twoFileResult.swarmengineScopedLaneVisible &&
		twoFileResult.swarmengineScopeStayedBounded &&
		twoFileResult.swarmengineArtifactTruthVisible &&
		twoFileResult.queenbeeTwoFileLaneVisible &&
		twoFileResult.queenbeeScopeStayedBounded &&
		twoFileResult.queenbeeCompletionEvidenceVisible

	const gateDocPresent = includesAll(gateDocText, [
		"# QueenBee Candidate Gate One",
		"## Current Answer",
		"## Gate One Inputs",
		"## Expansion Blockers",
		"## What HOLD Does Not Mean",
	])
	const gateDocSaysHold = includesAll(gateDocText, [
		"`HOLD`",
		"`swarmengine` stays the shipped bounded engine",
		"confidence gain is real but not yet decisive",
		"finish the explicit decision/handoff band",
	])
	const blockerListPresent = includesAll(gateDocText, [
		"extra QueenBee handoffs",
		"public claims must stay unchanged",
		"Session 202 decision and roadmap handoff",
	])
	const readmeBoundaryAligned =
		includesAll(
			readmeText,
			[
				"`queenbee` is not part of the current public product claim",
				"QUEENBEE_CANDIDATE_GATE_ONE.md",
				"current internal answer is `HOLD`",
			],
		) &&
		includesAll(candidateArchitectureText, ["## Session 201 Candidate Gate One", "`npm.cmd run verify:queenbee:gate1`", "`HOLD`"])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: Session 201 uses a HOLD gate until QueenBee earns expansion",
		"**Session:** 201",
		"`HOLD` gate instead of a forced green light",
	])

	details.push(
		`comparisonProofsGreen=${comparisonProofsGreen ? "yes" : "no"}`,
		`gateDocPresent=${gateDocPresent ? "yes" : "no"}`,
		`gateDocSaysHold=${gateDocSaysHold ? "yes" : "no"}`,
		`blockerListPresent=${blockerListPresent ? "yes" : "no"}`,
		`readmeBoundaryAligned=${readmeBoundaryAligned ? "yes" : "no"}`,
	)

	return {
		comparisonProofsGreen,
		gateDocPresent,
		gateDocSaysHold,
		blockerListPresent,
		readmeBoundaryAligned,
		architectureDecisionRecorded,
		details,
	}
}

export function formatQueenBeeGateOneHarnessResult(result: QueenBeeGateOneHarnessResult): string {
	return [
		`Comparison proofs green: ${result.comparisonProofsGreen ? "PASS" : "FAIL"}`,
		`Gate doc present: ${result.gateDocPresent ? "PASS" : "FAIL"}`,
		`Gate doc says HOLD: ${result.gateDocSaysHold ? "PASS" : "FAIL"}`,
		`Blocker list present: ${result.blockerListPresent ? "PASS" : "FAIL"}`,
		`Readme boundary aligned: ${result.readmeBoundaryAligned ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGateOneHarness()
	console.log(formatQueenBeeGateOneHarnessResult(result))
	process.exit(
		result.comparisonProofsGreen &&
			result.gateDocPresent &&
			result.gateDocSaysHold &&
			result.blockerListPresent &&
			result.readmeBoundaryAligned &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gate1] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
