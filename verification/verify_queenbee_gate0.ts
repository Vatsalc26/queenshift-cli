import fs from "node:fs"
import path from "node:path"

import { runQueenBeeDocsHarness } from "./verify_queenbee_docs"
import { runQueenBeeProtocolHarness } from "./verify_queenbee_protocol"
import { runQueenBeeMessagesHarness } from "./verify_queenbee_messages"
import { runQueenBeeRoutesHarness } from "./verify_queenbee_routes"
import { runQueenBeeStateHarness } from "./verify_queenbee_state"
import { runQueenBeeRegistryHarness } from "./verify_queenbee_registry"
import { runQueenBeeGrantsHarness } from "./verify_queenbee_grants"

export type QueenBeeGateZeroHarnessResult = {
	freezeBandProofsGreen: boolean
	gateDocPresent: boolean
	gateDocSaysGo: boolean
	scaffoldingStartRulePresent: boolean
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

export async function runQueenBeeGateZeroHarness(rootDir = resolveRootDir()): Promise<QueenBeeGateZeroHarnessResult> {
	const details: string[] = []
	const [
		docsResult,
		protocolResult,
		messagesResult,
		routesResult,
		stateResult,
		registryResult,
		grantsResult,
	] = await Promise.all([
		runQueenBeeDocsHarness(rootDir),
		runQueenBeeProtocolHarness(rootDir),
		runQueenBeeMessagesHarness(rootDir),
		runQueenBeeRoutesHarness(rootDir),
		runQueenBeeStateHarness(rootDir),
		runQueenBeeRegistryHarness(rootDir),
		runQueenBeeGrantsHarness(rootDir),
	])

	const gateDocText = readText(rootDir, "QUEENBEE_CANDIDATE_GATE_ZERO.md")
	const candidateArchitectureText = readText(rootDir, "QUEENBEE_PROTOCOL_ARCHITECTURE_CANDIDATE.md")
	const firstSliceText = readText(rootDir, "QUEENBEE_JS_TS_FIRST_SLICE.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")

	const freezeBandProofsGreen =
		docsResult.readmeCandidateBoundaryAligned &&
		docsResult.readmeRoadmapAligned &&
		docsResult.candidateFreezeContractPresent &&
		docsResult.firstSliceFreezeContractPresent &&
		docsResult.architectureFreezeDecisionRecorded &&
		docsResult.verificationCatalogAligned &&
		protocolResult.engineBoundaryAligned &&
		protocolResult.protocolVersionAligned &&
		protocolResult.beeRosterAligned &&
		protocolResult.taskFamilyOrderAligned &&
		protocolResult.coreProtocolDocsPresent &&
		messagesResult.packetFreezeContractPresent &&
		messagesResult.envelopeFieldsAligned &&
		messagesResult.messageFamiliesAligned &&
		messagesResult.routeBindingPresent &&
		messagesResult.assignmentExampleAligned &&
		routesResult.routeFreezeContractPresent &&
		routesResult.allowedEdgesAligned &&
		routesResult.routerMediationPreserved &&
		routesResult.forbiddenEdgesAligned &&
		routesResult.changeControlPresent &&
		stateResult.stateFreezeContractPresent &&
		stateResult.sharedStatesAligned &&
		stateResult.transitionsAligned &&
		stateResult.beeClassCoveragePresent &&
		stateResult.changeControlPresent &&
		registryResult.registryFreezeContractPresent &&
		registryResult.entryShapeAligned &&
		registryResult.selectionAndInvariantsAligned &&
		registryResult.firstRosterAligned &&
		registryResult.changeControlPresent &&
		grantsResult.grantFreezeContractPresent &&
		grantsResult.toolFamiliesAligned &&
		grantsResult.defaultGrantMatrixAligned &&
		grantsResult.denialsAndTokenRulesAligned &&
		grantsResult.changeControlPresent

	const gateDocPresent = includesAll(gateDocText, [
		"# QueenBee Candidate Gate Zero",
		"## Current Answer",
		"## Gate Zero Inputs",
		"## Freeze-Band Blocker List",
		"## Scaffolding Start Decision",
		"## What Gate Zero Does Not Mean",
	])
	const gateDocSaysGo = includesAll(gateDocText, [
		"`GO`",
		"`swarmengine` stays the shipped default",
		"`queenbee` stays behind explicit engine selection",
		"do not widen public claims",
		"none inside the frozen protocol contract",
	])
	const scaffoldingStartRulePresent =
		includesAll(candidateArchitectureText, ["`npm.cmd run verify:queenbee:gate0`", "QUEENBEE_CANDIDATE_GATE_ZERO.md"]) &&
		includesAll(firstSliceText, ["## Gate Zero Scaffolding Start Rule", "QUEENBEE_CANDIDATE_GATE_ZERO.md", "engine flag and runtime split"])
	const architectureDecisionRecorded = includesAll(architectureText, [
		"## Decision: QueenBee gate zero is the bounded scaffolding start gate",
		"**Session:** 186",
		"`GO` for bounded scaffolding",
	])

	details.push(
		`freezeBandProofsGreen=${freezeBandProofsGreen ? "yes" : "no"}`,
		`gateDocPresent=${gateDocPresent ? "yes" : "no"}`,
		`gateDocSaysGo=${gateDocSaysGo ? "yes" : "no"}`,
		`scaffoldingStartRulePresent=${scaffoldingStartRulePresent ? "yes" : "no"}`,
	)

	return {
		freezeBandProofsGreen,
		gateDocPresent,
		gateDocSaysGo,
		scaffoldingStartRulePresent,
		architectureDecisionRecorded,
		details,
	}
}

export function formatQueenBeeGateZeroHarnessResult(result: QueenBeeGateZeroHarnessResult): string {
	return [
		`Freeze-band proofs green: ${result.freezeBandProofsGreen ? "PASS" : "FAIL"}`,
		`Gate doc present: ${result.gateDocPresent ? "PASS" : "FAIL"}`,
		`Gate doc says GO: ${result.gateDocSaysGo ? "PASS" : "FAIL"}`,
		`Scaffolding start rule present: ${result.scaffoldingStartRulePresent ? "PASS" : "FAIL"}`,
		`Architecture decision recorded: ${result.architectureDecisionRecorded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeGateZeroHarness()
	console.log(formatQueenBeeGateZeroHarnessResult(result))
	process.exit(
		result.freezeBandProofsGreen &&
			result.gateDocPresent &&
			result.gateDocSaysGo &&
			result.scaffoldingStartRulePresent &&
			result.architectureDecisionRecorded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:gate0] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
