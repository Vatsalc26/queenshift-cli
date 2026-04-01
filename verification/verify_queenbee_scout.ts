import fs from "node:fs"
import path from "node:path"

import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"

export type QueenBeeScoutHarnessResult = {
	scoutDocsPresent: boolean
	packageScriptPresent: boolean
	scoutEdgesImplemented: boolean
	scoutRequestDelivered: boolean
	scoutStayedReadOnlyAndBounded: boolean
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export async function runQueenBeeScoutHarness(rootDir = resolveRootDir()): Promise<QueenBeeScoutHarnessResult> {
	const details: string[] = []
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const capabilityText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as {
		scripts?: Record<string, string>
	}

	const scoutDocsPresent =
		includesAll(messageSchemaText, [
			"## Session 192 Scout And Reservation Shell",
			"`scout_request`",
			"`scout_result`",
			"`workspace`",
			"`contextFiles`",
		]) &&
		includesAll(protocolMapText, [
			"## Session 192 Runtime Scout And Reservation",
			"`RouterBee -> ScoutBee`",
			"`scout_request`",
			"`scout_result`",
		]) &&
		includesAll(capabilityText, [
			"## Session 192 Capability Reservation Flow",
			"`RegistryBee`",
			"`ScoutBee`",
			"`bee_reserve_request`",
		]) &&
		includesAll(architectureText, [
			"## Decision: QueenBee ScoutBee stays read-only and reservation stays protocol-visible",
			"**Session:** 192",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:scout`", "`npm.cmd run verify:queenbee:reservation`"])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:scout"] === "npm run build && node dist/verification/verify_queenbee_scout.js"

	const shell = createQueenBeeShell()
	const scoutEdgesImplemented =
		shell.router.listImplementedEdges().includes("RouterBee->ScoutBee") &&
		shell.router.listImplementedEdges().includes("ScoutBee->RouterBee")

	const workspace = path.join(rootDir, "verification", "test_workspace")
	const scoutEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-scout-request",
		missionId: "mission-scout-1",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.scout.001",
		messageType: "scout_request",
		timestamp: "2026-03-26T12:40:00Z",
		payload: {
			task: "Update hello.ts",
			workspace,
			targetFiles: ["hello.ts"],
			languagePack: "js_ts",
		},
	})
	const scoutResult = shell.router.routeEnvelope(scoutEnvelope)
	const scoutPayload = asRecord(scoutResult.responseEnvelope?.payload)
	const contextFiles = Array.isArray(scoutPayload?.["contextFiles"]) ? (scoutPayload["contextFiles"] as string[]) : []
	const scoutRequestDelivered =
		scoutResult.status === "delivered" &&
		scoutResult.edge === "RouterBee->ScoutBee" &&
		scoutResult.responseEnvelope?.messageType === "scout_result" &&
		scoutPayload?.["accepted"] === true &&
		scoutPayload?.["readOnly"] === true &&
		contextFiles.includes("package.json")

	const tooWideEnvelope = buildQueenBeeEnvelope({
		messageId: "msg-scout-too-wide",
		missionId: "mission-scout-2",
		senderBeeId: "queenbee.router.001",
		recipientBeeId: "queenbee.scout.001",
		messageType: "scout_request",
		timestamp: "2026-03-26T12:41:00Z",
		payload: {
			task: "Update hello.ts, utils.ts, math.ts",
			workspace,
			targetFiles: ["hello.ts", "utils.ts", "math.ts"],
			languagePack: "js_ts",
		},
	})
	const tooWideResult = shell.router.routeEnvelope(tooWideEnvelope)
	const tooWidePayload = asRecord(tooWideResult.responseEnvelope?.payload)
	const scoutStayedReadOnlyAndBounded =
		tooWideResult.status === "delivered" &&
		tooWideResult.responseEnvelope?.messageType === "scout_result" &&
		tooWidePayload?.["accepted"] === false &&
		tooWidePayload?.["reason"] === "scout_target_count_out_of_bounds"

	details.push(
		`implementedEdges=${shell.router.listImplementedEdges().join(",")}`,
		`contextFiles=${contextFiles.join(",") || "missing"}`,
		`tooWideReason=${String(tooWidePayload?.["reason"] ?? "missing")}`,
	)

	return {
		scoutDocsPresent,
		packageScriptPresent,
		scoutEdgesImplemented,
		scoutRequestDelivered,
		scoutStayedReadOnlyAndBounded,
		details,
	}
}

export function formatQueenBeeScoutHarnessResult(result: QueenBeeScoutHarnessResult): string {
	return [
		`Scout docs present: ${result.scoutDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Scout edges implemented: ${result.scoutEdgesImplemented ? "PASS" : "FAIL"}`,
		`Scout request delivered: ${result.scoutRequestDelivered ? "PASS" : "FAIL"}`,
		`Scout stayed read-only and bounded: ${result.scoutStayedReadOnlyAndBounded ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeScoutHarness()
	console.log(formatQueenBeeScoutHarnessResult(result))
	process.exit(
		result.scoutDocsPresent &&
			result.packageScriptPresent &&
			result.scoutEdgesImplemented &&
			result.scoutRequestDelivered &&
			result.scoutStayedReadOnlyAndBounded
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:scout] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
