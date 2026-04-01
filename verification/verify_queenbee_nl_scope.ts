import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope, type QueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { normalizeRelPath } from "../src/run/TaskContract"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeNaturalLanguageScopeHarnessResult = {
	nlScopeDocsPresent: boolean
	packageScriptPresent: boolean
	messageValidatorAcceptsCompiledRequests: boolean
	scoutCompilesDirectScope: boolean
	plannerCompilesDirectFamily: boolean
	scoutCompilesSemiOpenScope: boolean
	plannerCompilesSemiOpenFamily: boolean
	scoutCompilesRetryCallerScope: boolean
	plannerCompilesRetryCallerFamily: boolean
	scoutCompilesUiLogicScope: boolean
	plannerCompilesUiLogicFamily: boolean
	plannerRefusesPreScoutAnchoredLane: boolean
	plannerRefusesPreScoutRetryCallerLane: boolean
	plannerRefusesPreScoutUiLogicLane: boolean
	plannerRefusesExplicitFamilyMismatch: boolean
	unsupportedAndUnanchoredRowsRefuse: boolean
	publicBoundaryPreserved: boolean
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

function hasSameFileSet(left: string[], right: string[]): boolean {
	const leftSet = new Set(left.map((entry) => normalizeRelPath(entry)))
	const rightSet = new Set(right.map((entry) => normalizeRelPath(entry)))
	if (leftSet.size !== rightSet.size) return false
	for (const value of leftSet) {
		if (!rightSet.has(value)) return false
	}
	return true
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readAssignmentPacket(envelope: QueenBeeEnvelope | null): QueenBeeEnvelope | null {
	const payload = asRecord(envelope?.payload)
	if (!payload || !Array.isArray(payload["assignmentPackets"])) return null
	const first = payload["assignmentPackets"][0]
	return first && typeof first === "object" && !Array.isArray(first) ? (first as QueenBeeEnvelope) : null
}

export async function runQueenBeeNaturalLanguageScopeHarness(
	rootDir = resolveRootDir(),
): Promise<QueenBeeNaturalLanguageScopeHarnessResult> {
	const details: string[] = []
	const scopeContractText = readText(rootDir, "QUEENBEE_NATURAL_LANGUAGE_SCOPE_CONTRACT.md")
	const conopsText = readText(rootDir, "QUEENBEE_CONOPS.md")
	const publicUsabilityText = readText(rootDir, "QUEENBEE_PUBLIC_USABILITY_REQUIREMENTS.md")
	const allocationPolicyText = readText(rootDir, "QUEENBEE_ALLOCATION_POLICY.md")
	const traceabilityText = readText(rootDir, "QUEENBEE_REQUIREMENTS_TRACEABILITY_MATRIX.md")
	const canonicalTaskText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const gapRegisterText = readText(rootDir, "QUEENBEE_GAP_REGISTER.md")
	const dailyProgramText = readText(rootDir, "QUEENBEE_DAILY_JSTS_PROGRAM.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const messageSchemaText = readText(rootDir, "QUEENBEE_MESSAGE_SCHEMA.md")
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const nlScopeDocsPresent =
		includesAll(scopeContractText, [
			"# QueenBee Natural-Language Scope Contract",
			"compile to explicit internal target files and one bounded task family before coding",
			"`update_file_and_test`",
			"`bounded_two_file_update`",
			"`rename_export`",
			"`verify:queenbee:nl-scope`",
			"the task family and compiled scope disagree",
			"## Session 267 Intake Hardening Reading",
			"update its direct imports",
		]) &&
		includesAll(scopeContractText, [
			"## Session 273 Repo-Local UI Anchor Reading",
			"existing-file UI logic rows may now start from one named existing UI anchor file",
			"exactly one direct same-directory JS/TS companion",
		]) &&
		includesAll(scopeContractText, [
			"## Session 275 Expert Helper-Test Reading",
			"keep its direct local test aligned",
			"same bounded `update_file_and_test` scope",
		]) &&
		includesAll(conopsText, [
			"bounded natural-language scope rows may compile calmer task wording into explicit internal targets before planning",
			"do not widen public language just because the internal scope compiler gets better",
			"retry/caller",
		]) &&
		includesAll(publicUsabilityText, [
			"bounded natural-language row that compiles to explicit targets",
			"`QUEENBEE_NATURAL_LANGUAGE_SCOPE_CONTRACT.md`",
		]) &&
		includesAll(allocationPolicyText, [
			"explicit or compiled-explicit target-file set",
			"`QUEENBEE_NATURAL_LANGUAGE_SCOPE_CONTRACT.md`",
		]) &&
		includesAll(traceabilityText, [
			"`QB-TR-13`",
			"`bounded_natural_language_scope_compile`",
			"`verify:queenbee:nl-scope`",
		]) &&
		includesAll(traceabilityText, [
			"retry/caller, existing-file UI logic, and rename rows still need ScoutBee",
			"`verify:queenbee:gateway`",
		]) &&
		includesAll(canonicalTaskText, [
			"## Session 233 Natural-Language Scope Answer",
			"calmer real-user wording",
			"same canonical row truth",
			"## Session 267 Natural-Language Intake Update",
			"`update its direct imports`",
		]) &&
		includesAll(gapRegisterText, [
			"## Session 267 Reading",
			"direct-import alias",
			"`rename_export` scope",
		]) &&
		includesAll(gapRegisterText, [
			"`QB-GAP-273-01`",
			"`CLOSED_SESSION_273`",
			"one named existing UI anchor may expand to exactly one direct same-directory JS/TS companion",
		]) &&
		includesAll(dailyProgramText, [
			"## Session 267 Intake Hardening Update",
			"`update its direct imports`",
			"`rename_export` scope",
		]) &&
		includesAll(dailyProgramText, [
			"## Session 273 Repo-Local Scope Compile And Scout Widening",
			"one named existing UI anchor file may now expand to exactly one direct same-directory JS/TS companion",
			"`verify:queenbee:gateway`",
		]) &&
		includesAll(dailyProgramText, [
			"## Session 275 Expert Helper-Test Intake Update",
			"keep its direct local test aligned",
			"`update_file_and_test` scope",
		]) &&
		includesAll(reverseEngineeringMapText, [
			"## Session 233 Natural-Language Scope Answer",
			"calmer wording may now compile to the same bounded canonical rows",
			"helper/test, retry/caller, existing-file UI logic, and rename rows still require ScoutBee to expand one anchor into explicit scope",
		]) &&
		includesAll(reverseEngineeringMapText, [
			"## Session 273 Repo-Local Scope Answer",
			"one named UI anchor may now expand to exactly one direct same-directory UI companion",
			"`QB-GW-04`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 233 QueenBee Natural-Language Scope Note",
			"compile to the same explicit internal scope and proof contract",
			"does not widen the public beta family set",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 233 compiles bounded natural-language asks into explicit QueenBee scope before planning",
			"**Session:** 233",
			"## Decision: Session 267 accepts one calmer direct-import rename phrasing without widening QueenBee scope",
			"**Session:** 267",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 273 widens bounded repo-local natural-language scope by one UI-anchor lane and one aggregate gateway proof",
			"**Session:** 273",
			"`verify:queenbee:gateway`",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 275 carries one calmer anchor-first helper/test phrasing across the bounded natural-language hold and UX surfaces",
			"**Session:** 275",
			"`update_file_and_test`",
		]) &&
		includesAll(messageSchemaText, [
			"## Session 233 Natural-Language Scope Compile",
			"`scout_request` may omit `targetFiles`",
			"`plan_request` may omit `taskFamily`",
			"retry/caller",
		]) &&
		includesAll(protocolMapText, [
			"## Session 233 Natural-Language Scope Compile",
			"`RouterBee -> ScoutBee` may compile explicit target files",
			"`PlannerBee` may derive one bounded task family from compiled scope",
			"retry/caller",
		]) &&
		includesAll(verificationCatalogText, [
			"`npm.cmd run verify:queenbee:nl-scope`",
			"bounded natural-language scope compile",
			"the Session 267 natural-language intake hardening now accepts one calmer direct-import rename alias",
		])
		&& includesAll(verificationCatalogText, [
			"the Session 273 bounded repo-local scope widening now accepts one named UI anchor",
			"`npm.cmd run verify:queenbee:gateway`",
			"the Session 275 expert helper/test intake hardening now carries one calmer anchor-first helper/test phrasing",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:nl-scope"] === "npm run build && node dist/verification/verify_queenbee_nl_scope.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-nl-scope")
	try {
		const srcDir = path.join(fixture.repoPath, "src")
		fs.mkdirSync(srcDir, { recursive: true })
		fs.writeFileSync(
			path.join(srcDir, "format.ts"),
			'export function formatValue(input: string): string {\n\treturn input.trim()\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(srcDir, "format.test.ts"),
			'import { formatValue } from "./format"\n\nexport function verifyFormatValue(): string {\n\treturn formatValue(" hi ")\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(srcDir, "index.ts"),
			'import { formatValue } from "./format"\n\nexport function renderLabel(input: string): string {\n\treturn formatValue(input)\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(srcDir, "retry.ts"),
			'export async function retryWithBackoff<T>(work: () => Promise<T>): Promise<T> {\n\treturn await work()\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(srcDir, "client.ts"),
			'import { retryWithBackoff } from "./retry"\n\nexport async function runClient(work: () => Promise<string>): Promise<string> {\n\treturn await retryWithBackoff(work)\n}\n',
			"utf8",
		)
		fs.mkdirSync(path.join(srcDir, "ui"), { recursive: true })
		fs.writeFileSync(
			path.join(srcDir, "ui", "Panel.tsx"),
			'import { buildPanelLabel } from "./panelLogic"\n\nexport function Panel(): string {\n\treturn buildPanelLabel("queenbee")\n}\n',
			"utf8",
		)
		fs.writeFileSync(
			path.join(srcDir, "ui", "panelLogic.ts"),
			'export function buildPanelLabel(input: string): string {\n\treturn input.toUpperCase()\n}\n',
			"utf8",
		)
		fs.writeFileSync(path.join(fixture.repoPath, "README.md"), "# Verification Repo\n", "utf8")

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })
		const workspace = fixture.repoPath

		const scoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-direct",
			missionId: "mission-nl-scope-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:10:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: nl scope" to hello.ts',
				workspace,
				languagePack: "js_ts",
			},
		})
		const planRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-direct",
			missionId: "mission-nl-scope-2",
			assignmentId: "assign-nl-scope-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:11:00Z",
			payload: {
				task: "update hello.ts and utils.ts together",
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const messageValidatorAcceptsCompiledRequests =
			shell.messageValidator.validateEnvelope(scoutRequest).valid && shell.messageValidator.validateEnvelope(planRequest).valid

		const scoutDirectResult = shell.router.routeEnvelope(scoutRequest)
		const scoutDirectPayload = asRecord(scoutDirectResult.responseEnvelope?.payload)
		const scoutDirectTargets = Array.isArray(scoutDirectPayload?.["targetFiles"]) ? (scoutDirectPayload["targetFiles"] as string[]) : []
		const scoutDirectContext = Array.isArray(scoutDirectPayload?.["contextFiles"]) ? (scoutDirectPayload["contextFiles"] as string[]) : []
		const scoutCompilesDirectScope =
			scoutDirectResult.status === "delivered" &&
			scoutDirectPayload?.["accepted"] === true &&
			scoutDirectTargets.join(",") === "hello.ts" &&
			scoutDirectContext.includes("package.json") &&
			String(scoutDirectPayload?.["scoutSummary"] ?? "").includes("comment_file")

		const planDirectResult = shell.router.routeEnvelope(planRequest)
		const planDirectPayload = asRecord(planDirectResult.responseEnvelope?.payload)
		const planDirectPacket = readAssignmentPacket(planDirectResult.responseEnvelope)
		const planDirectPacketPayload = asRecord(planDirectPacket?.payload)
		const directAllowedFiles = Array.isArray(planDirectPacketPayload?.["allowedFiles"])
			? (planDirectPacketPayload["allowedFiles"] as string[])
			: []
		const plannerCompilesDirectFamily =
			planDirectResult.status === "delivered" &&
			planDirectPayload?.["accepted"] === true &&
			planDirectPayload?.["taskFamily"] === "bounded_two_file_update" &&
			directAllowedFiles.join(",") === "hello.ts,utils.ts"

		const scoutHelperRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-helper",
			missionId: "mission-nl-scope-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:12:00Z",
			payload: {
				task: "update src/format.ts and keep its direct local test aligned",
				workspace,
				languagePack: "js_ts",
			},
		})
		const scoutHelperResult = shell.router.routeEnvelope(scoutHelperRequest)
		const scoutHelperPayload = asRecord(scoutHelperResult.responseEnvelope?.payload)
		const scoutHelperTargets = Array.isArray(scoutHelperPayload?.["targetFiles"]) ? (scoutHelperPayload["targetFiles"] as string[]) : []

		const scoutRenameRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-rename",
			missionId: "mission-nl-scope-4",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:13:00Z",
			payload: {
				task: "rename formatValue in src/format.ts to renderValue and update its direct imports",
				workspace,
				languagePack: "js_ts",
			},
		})
		const scoutRenameResult = shell.router.routeEnvelope(scoutRenameRequest)
		const scoutRenamePayload = asRecord(scoutRenameResult.responseEnvelope?.payload)
		const scoutRenameTargets = Array.isArray(scoutRenamePayload?.["targetFiles"]) ? (scoutRenamePayload["targetFiles"] as string[]) : []

		const scoutCompilesSemiOpenScope =
			scoutHelperResult.status === "delivered" &&
			scoutHelperPayload?.["accepted"] === true &&
			scoutHelperTargets.join(",") === "src/format.ts,src/format.test.ts" &&
			scoutRenameResult.status === "delivered" &&
			scoutRenamePayload?.["accepted"] === true &&
			scoutRenameTargets.join(",") === "src/format.test.ts,src/format.ts,src/index.ts"

		const scoutRetryCallerRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-retry-caller",
			missionId: "mission-nl-scope-4b",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:13:30Z",
			payload: {
				task: 'update src/retry.ts and keep its direct caller aligned so both files include the exact comment "// queenbee: retry caller"',
				workspace,
				languagePack: "js_ts",
			},
		})
		const scoutRetryCallerResult = shell.router.routeEnvelope(scoutRetryCallerRequest)
		const scoutRetryCallerPayload = asRecord(scoutRetryCallerResult.responseEnvelope?.payload)
		const scoutRetryCallerTargets = Array.isArray(scoutRetryCallerPayload?.["targetFiles"])
			? (scoutRetryCallerPayload["targetFiles"] as string[])
			: []
		const scoutCompilesRetryCallerScope =
			scoutRetryCallerResult.status === "delivered" &&
			scoutRetryCallerPayload?.["accepted"] === true &&
			scoutRetryCallerTargets.join(",") === "src/client.ts,src/retry.ts"

		const scoutUiLogicRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-ui-logic",
			missionId: "mission-nl-scope-4c",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-04-01T10:16:00Z",
			payload: {
				task: 'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: ui logic"',
				workspace,
				languagePack: "js_ts",
			},
		})
		const scoutUiLogicResult = shell.router.routeEnvelope(scoutUiLogicRequest)
		const scoutUiLogicPayload = asRecord(scoutUiLogicResult.responseEnvelope?.payload)
		const scoutUiLogicTargets = Array.isArray(scoutUiLogicPayload?.["targetFiles"])
			? (scoutUiLogicPayload["targetFiles"] as string[])
			: []
		const scoutCompilesUiLogicScope =
			scoutUiLogicResult.status === "delivered" &&
			scoutUiLogicPayload?.["accepted"] === true &&
			hasSameFileSet(scoutUiLogicTargets, ["src/ui/Panel.tsx", "src/ui/panelLogic.ts"])

		const planHelperRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-helper",
			missionId: "mission-nl-scope-5",
			assignmentId: "assign-nl-scope-5",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:14:00Z",
			payload: {
				task: "update src/format.ts and keep its direct local test aligned",
				targetFiles: scoutHelperTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const planRenameRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-rename",
			missionId: "mission-nl-scope-6",
			assignmentId: "assign-nl-scope-6",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:15:00Z",
			payload: {
				task: "rename formatValue in src/format.ts to renderValue and update its direct imports",
				targetFiles: scoutRenameTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const planHelperResult = shell.router.routeEnvelope(planHelperRequest)
		const planHelperPayload = asRecord(planHelperResult.responseEnvelope?.payload)
		const planHelperPacketPayload = asRecord(readAssignmentPacket(planHelperResult.responseEnvelope)?.payload)
		const helperAllowedFiles = Array.isArray(planHelperPacketPayload?.["allowedFiles"])
			? (planHelperPacketPayload["allowedFiles"] as string[])
			: []
		const planRenameResult = shell.router.routeEnvelope(planRenameRequest)
		const planRenamePayload = asRecord(planRenameResult.responseEnvelope?.payload)
		const planRenamePacketPayload = asRecord(readAssignmentPacket(planRenameResult.responseEnvelope)?.payload)
		const renameAllowedFiles = Array.isArray(planRenamePacketPayload?.["allowedFiles"])
			? (planRenamePacketPayload["allowedFiles"] as string[])
			: []
		const planRetryCallerRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-retry-caller",
			missionId: "mission-nl-scope-6b",
			assignmentId: "assign-nl-scope-6b",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:15:30Z",
			payload: {
				task: 'update src/retry.ts and keep its direct caller aligned so both files include the exact comment "// queenbee: retry caller"',
				targetFiles: scoutRetryCallerTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const planRetryCallerResult = shell.router.routeEnvelope(planRetryCallerRequest)
		const planRetryCallerPayload = asRecord(planRetryCallerResult.responseEnvelope?.payload)
		const planRetryCallerPacketPayload = asRecord(readAssignmentPacket(planRetryCallerResult.responseEnvelope)?.payload)
		const retryCallerAllowedFiles = Array.isArray(planRetryCallerPacketPayload?.["allowedFiles"])
			? (planRetryCallerPacketPayload["allowedFiles"] as string[])
			: []
		const plannerCompilesSemiOpenFamily =
			planHelperResult.status === "delivered" &&
			planHelperPayload?.["accepted"] === true &&
			planHelperPayload?.["taskFamily"] === "update_file_and_test" &&
			helperAllowedFiles.join(",") === "src/format.ts,src/format.test.ts" &&
			planRenameResult.status === "delivered" &&
			planRenamePayload?.["accepted"] === true &&
			planRenamePayload?.["taskFamily"] === "rename_export" &&
			renameAllowedFiles.join(",") === "src/format.test.ts,src/format.ts,src/index.ts"
		const plannerCompilesRetryCallerFamily =
			planRetryCallerResult.status === "delivered" &&
			planRetryCallerPayload?.["accepted"] === true &&
			planRetryCallerPayload?.["taskFamily"] === "bounded_two_file_update" &&
			retryCallerAllowedFiles.join(",") === "src/client.ts,src/retry.ts"

		const planUiLogicRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-ui-logic",
			missionId: "mission-nl-scope-6c",
			assignmentId: "assign-nl-scope-6c",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-04-01T10:17:00Z",
			payload: {
				task: 'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: ui logic"',
				targetFiles: scoutUiLogicTargets,
				languagePack: "js_ts",
				protectedFiles: ["package.json"],
			},
		})
		const planUiLogicResult = shell.router.routeEnvelope(planUiLogicRequest)
		const planUiLogicPayload = asRecord(planUiLogicResult.responseEnvelope?.payload)
		const planUiLogicPacketPayload = asRecord(readAssignmentPacket(planUiLogicResult.responseEnvelope)?.payload)
		const uiLogicAllowedFiles = Array.isArray(planUiLogicPacketPayload?.["allowedFiles"])
			? (planUiLogicPacketPayload["allowedFiles"] as string[])
			: []
		const plannerCompilesUiLogicFamily =
			planUiLogicResult.status === "delivered" &&
			planUiLogicPayload?.["accepted"] === true &&
			planUiLogicPayload?.["taskFamily"] === "bounded_two_file_update" &&
			hasSameFileSet(uiLogicAllowedFiles, ["src/ui/Panel.tsx", "src/ui/panelLogic.ts"])

		const preScoutAnchoredPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-anchor-only",
			missionId: "mission-nl-scope-7",
			assignmentId: "assign-nl-scope-7",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:16:00Z",
			payload: {
				task: "rename formatValue in src/format.ts to renderValue and update its direct imports",
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const preScoutAnchoredPlanResult = shell.router.routeEnvelope(preScoutAnchoredPlanRequest)
		const preScoutAnchoredPlanPayload = asRecord(preScoutAnchoredPlanResult.responseEnvelope?.payload)
		const plannerRefusesPreScoutAnchoredLane =
			preScoutAnchoredPlanResult.status === "delivered" &&
			preScoutAnchoredPlanPayload?.["accepted"] === false &&
			preScoutAnchoredPlanPayload?.["reason"] === "natural_language_scope_requires_scout_resolution"

		const preScoutRetryCallerPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-retry-caller-anchor-only",
			missionId: "mission-nl-scope-7b",
			assignmentId: "assign-nl-scope-7b",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:16:30Z",
			payload: {
				task: 'update src/retry.ts and keep its direct caller aligned so both files include the exact comment "// queenbee: retry caller"',
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const preScoutRetryCallerPlanResult = shell.router.routeEnvelope(preScoutRetryCallerPlanRequest)
		const preScoutRetryCallerPlanPayload = asRecord(preScoutRetryCallerPlanResult.responseEnvelope?.payload)
		const plannerRefusesPreScoutRetryCallerLane =
			preScoutRetryCallerPlanResult.status === "delivered" &&
			preScoutRetryCallerPlanPayload?.["accepted"] === false &&
			preScoutRetryCallerPlanPayload?.["reason"] === "natural_language_scope_requires_scout_resolution"

		const preScoutUiLogicPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-ui-logic-anchor-only",
			missionId: "mission-nl-scope-7c",
			assignmentId: "assign-nl-scope-7c",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-04-01T10:18:30Z",
			payload: {
				task: 'update src/ui/Panel.tsx and keep its direct ui logic aligned so both files include the exact comment "// queenbee: ui logic"',
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const preScoutUiLogicPlanResult = shell.router.routeEnvelope(preScoutUiLogicPlanRequest)
		const preScoutUiLogicPlanPayload = asRecord(preScoutUiLogicPlanResult.responseEnvelope?.payload)
		const plannerRefusesPreScoutUiLogicLane =
			preScoutUiLogicPlanResult.status === "delivered" &&
			preScoutUiLogicPlanPayload?.["accepted"] === false &&
			preScoutUiLogicPlanPayload?.["reason"] === "natural_language_scope_requires_scout_resolution"

		const mismatchPlanRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-plan-mismatch",
			missionId: "mission-nl-scope-8",
			assignmentId: "assign-nl-scope-8",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.planner.001",
			messageType: "plan_request",
			timestamp: "2026-03-28T16:17:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: mismatch" to utils.ts',
				taskFamily: "update_named_file",
				targetFiles: ["utils.ts"],
				languagePack: "js_ts",
				protectedFiles: [],
			},
		})
		const mismatchPlanResult = shell.router.routeEnvelope(mismatchPlanRequest)
		const mismatchPlanPayload = asRecord(mismatchPlanResult.responseEnvelope?.payload)
		const plannerRefusesExplicitFamilyMismatch =
			mismatchPlanResult.status === "delivered" &&
			mismatchPlanPayload?.["accepted"] === false &&
			mismatchPlanPayload?.["reason"] === "natural_language_task_family_scope_mismatch"

		const unanchoredScoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-unanchored",
			missionId: "mission-nl-scope-9",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:18:00Z",
			payload: {
				task: "update the helper and keep its test aligned",
				workspace,
				languagePack: "js_ts",
			},
		})
		const unsupportedScoutRequest = buildQueenBeeEnvelope({
			messageId: "msg-nl-scout-unsupported",
			missionId: "mission-nl-scope-10",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.scout.001",
			messageType: "scout_request",
			timestamp: "2026-03-28T16:19:00Z",
			payload: {
				task: 'update src/format.ts and sync the docs so the readme contains the exact sentence "format sync"',
				workspace,
				languagePack: "js_ts",
			},
		})
		const unanchoredScoutResult = shell.router.routeEnvelope(unanchoredScoutRequest)
		const unanchoredScoutPayload = asRecord(unanchoredScoutResult.responseEnvelope?.payload)
		const unsupportedScoutResult = shell.router.routeEnvelope(unsupportedScoutRequest)
		const unsupportedScoutPayload = asRecord(unsupportedScoutResult.responseEnvelope?.payload)
		const unsupportedAndUnanchoredRowsRefuse =
			unanchoredScoutResult.status === "delivered" &&
			unanchoredScoutPayload?.["accepted"] === false &&
			unanchoredScoutPayload?.["reason"] === "natural_language_scope_missing_anchor_file" &&
			unsupportedScoutResult.status === "delivered" &&
			unsupportedScoutPayload?.["accepted"] === false &&
			unsupportedScoutPayload?.["reason"] === "natural_language_scope_unsupported_lane"

		const publicBoundaryPreserved =
			includesAll(conopsText, [
				"`swarmengine` remains the shipped bounded engine and default runtime path.",
				"the current public beta family set is `comment_file`, `update_named_file`, `bounded_two_file_update`, `update_file_and_test`, `rename_export`, and `bounded_node_cli_task`.",
			]) &&
			scopeContractText.includes("The public beta family set remains frozen.")

		details.push(
			`scoutDirectTargets=${scoutDirectTargets.join(",") || "missing"}`,
			`scoutHelperTargets=${scoutHelperTargets.join(",") || "missing"}`,
			`scoutRenameTargets=${scoutRenameTargets.join(",") || "missing"}`,
			`scoutRetryCallerTargets=${scoutRetryCallerTargets.join(",") || "missing"}`,
			`scoutUiLogicTargets=${scoutUiLogicTargets.join(",") || "missing"}`,
			`planDirectFamily=${String(planDirectPayload?.["taskFamily"] ?? "missing")}`,
			`planHelperFamily=${String(planHelperPayload?.["taskFamily"] ?? "missing")}`,
			`planRenameFamily=${String(planRenamePayload?.["taskFamily"] ?? "missing")}`,
			`planRetryCallerFamily=${String(planRetryCallerPayload?.["taskFamily"] ?? "missing")}`,
			`planUiLogicFamily=${String(planUiLogicPayload?.["taskFamily"] ?? "missing")}`,
			`preScoutReason=${String(preScoutAnchoredPlanPayload?.["reason"] ?? "missing")}`,
			`preScoutRetryCallerReason=${String(preScoutRetryCallerPlanPayload?.["reason"] ?? "missing")}`,
			`preScoutUiLogicReason=${String(preScoutUiLogicPlanPayload?.["reason"] ?? "missing")}`,
			`mismatchReason=${String(mismatchPlanPayload?.["reason"] ?? "missing")}`,
			`unanchoredReason=${String(unanchoredScoutPayload?.["reason"] ?? "missing")}`,
			`unsupportedReason=${String(unsupportedScoutPayload?.["reason"] ?? "missing")}`,
		)

		return {
			nlScopeDocsPresent,
			packageScriptPresent,
			messageValidatorAcceptsCompiledRequests,
			scoutCompilesDirectScope,
			plannerCompilesDirectFamily,
			scoutCompilesSemiOpenScope,
			plannerCompilesSemiOpenFamily,
			scoutCompilesRetryCallerScope,
			plannerCompilesRetryCallerFamily,
			scoutCompilesUiLogicScope,
			plannerCompilesUiLogicFamily,
			plannerRefusesPreScoutAnchoredLane,
			plannerRefusesPreScoutRetryCallerLane,
			plannerRefusesPreScoutUiLogicLane,
			plannerRefusesExplicitFamilyMismatch,
			unsupportedAndUnanchoredRowsRefuse,
			publicBoundaryPreserved,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeNaturalLanguageScopeHarnessResult(result: QueenBeeNaturalLanguageScopeHarnessResult): string {
	return [
		`NL scope docs present: ${result.nlScopeDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Message validator accepts compiled requests: ${result.messageValidatorAcceptsCompiledRequests ? "PASS" : "FAIL"}`,
		`Scout compiles direct scope: ${result.scoutCompilesDirectScope ? "PASS" : "FAIL"}`,
		`Planner compiles direct family: ${result.plannerCompilesDirectFamily ? "PASS" : "FAIL"}`,
		`Scout compiles semi-open scope: ${result.scoutCompilesSemiOpenScope ? "PASS" : "FAIL"}`,
		`Planner compiles semi-open family: ${result.plannerCompilesSemiOpenFamily ? "PASS" : "FAIL"}`,
		`Scout compiles retry/caller scope: ${result.scoutCompilesRetryCallerScope ? "PASS" : "FAIL"}`,
		`Planner compiles retry/caller family: ${result.plannerCompilesRetryCallerFamily ? "PASS" : "FAIL"}`,
		`Scout compiles UI logic scope: ${result.scoutCompilesUiLogicScope ? "PASS" : "FAIL"}`,
		`Planner compiles UI logic family: ${result.plannerCompilesUiLogicFamily ? "PASS" : "FAIL"}`,
		`Planner refuses pre-scout anchored lane: ${result.plannerRefusesPreScoutAnchoredLane ? "PASS" : "FAIL"}`,
		`Planner refuses pre-scout retry/caller lane: ${result.plannerRefusesPreScoutRetryCallerLane ? "PASS" : "FAIL"}`,
		`Planner refuses pre-scout UI logic lane: ${result.plannerRefusesPreScoutUiLogicLane ? "PASS" : "FAIL"}`,
		`Planner refuses explicit-family mismatch: ${result.plannerRefusesExplicitFamilyMismatch ? "PASS" : "FAIL"}`,
		`Unsupported and unanchored rows refuse: ${result.unsupportedAndUnanchoredRowsRefuse ? "PASS" : "FAIL"}`,
		`Public boundary preserved: ${result.publicBoundaryPreserved ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeNaturalLanguageScopeHarness()
	console.log(formatQueenBeeNaturalLanguageScopeHarnessResult(result))
	process.exit(
		result.nlScopeDocsPresent &&
			result.packageScriptPresent &&
			result.messageValidatorAcceptsCompiledRequests &&
			result.scoutCompilesDirectScope &&
			result.plannerCompilesDirectFamily &&
			result.scoutCompilesSemiOpenScope &&
			result.plannerCompilesSemiOpenFamily &&
			result.scoutCompilesRetryCallerScope &&
			result.plannerCompilesRetryCallerFamily &&
			result.scoutCompilesUiLogicScope &&
			result.plannerCompilesUiLogicFamily &&
			result.plannerRefusesPreScoutAnchoredLane &&
			result.plannerRefusesPreScoutRetryCallerLane &&
			result.plannerRefusesPreScoutUiLogicLane &&
			result.plannerRefusesExplicitFamilyMismatch &&
			result.unsupportedAndUnanchoredRowsRefuse &&
			result.publicBoundaryPreserved
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:nl-scope] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
