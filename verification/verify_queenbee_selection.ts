import fs from "node:fs"
import path from "node:path"

import { createQueenBeeShell } from "../src/queenbee/QueenBeeShell"
import { buildQueenBeeEnvelope } from "../src/queenbee/QueenBeeProtocol"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

export type QueenBeeSelectionHarnessResult = {
	selectionDocsPresent: boolean
	reverseEngineeringDocsPresent: boolean
	packageScriptPresent: boolean
	specialistListVisible: boolean
	coreWinsPlainTask: boolean
	asyncWinsAsyncTask: boolean
	nodeWinsNodeTask: boolean
	testWinsFileAndTestTask: boolean
	refactorWinsTwoFileTask: boolean
	selectionStayedBounded: boolean
	clonePolicyStayedSingleton: boolean
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

export async function runQueenBeeSelectionHarness(rootDir = resolveRootDir()): Promise<QueenBeeSelectionHarnessResult> {
	const details: string[] = []
	const protocolMapText = readText(rootDir, "QUEENBEE_PROTOCOL_MAP.md")
	const registryText = readText(rootDir, "QUEENBEE_CAPABILITY_REGISTRY.md")
	const reverseEngineeringMapText = readText(rootDir, "QUEENBEE_REVERSE_ENGINEERING_MAP.md")
	const canonicalTaskText = readText(rootDir, "QUEENBEE_CANONICAL_TASK_SET.md")
	const envelopesText = readText(rootDir, "QUEENBEE_BEE_OPERATING_ENVELOPES.md")
	const parallelModelText = readText(rootDir, "QUEENBEE_PARALLEL_EXECUTION_MODEL.md")
	const taskCorpusText = readText(rootDir, "TASK_CORPUS.md")
	const architectureText = readText(rootDir, "ARCHITECTURE_DECISIONS.md")
	const verificationCatalogText = readText(rootDir, "VERIFICATION_CATALOG.md")
	const packageJson = JSON.parse(readText(rootDir, "package.json")) as { scripts?: Record<string, string> }

	const selectionDocsPresent =
		includesAll(protocolMapText, [
			"## Session 209 Async Specialist Selection",
			"## Session 210 Node Specialist Selection",
			"`JSTSCoderBee` may now select `JSTSAsyncBee`",
			"`JSTSCoderBee` may now select `JSTSNodeBee`",
			"task text plus already-scoped file evidence",
			"`verify:queenbee:selection`",
		]) &&
		includesAll(registryText, [
			"## Session 209 Async Specialist Runtime",
			"## Session 210 Node Specialist Runtime",
			"task text or the already-scoped file contents",
			"`JSTSNodeBee` is now live",
			"`verify:queenbee:selection`",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 209 QueenBee Async Specialist Note",
			"## Session 210 QueenBee Node/CLI Lane Note",
			"not a broader autonomy claim",
			"this widening still does not claim broad repo CLI surgery",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 209 lets JSTSAsyncBee beat the core default only on bounded async evidence",
			"## Decision: Session 210 lets JSTSNodeBee own the first bounded Node/CLI lane inside the existing coder slot",
			"already-scoped file evidence",
		]) &&
		includesAll(verificationCatalogText, ["`npm.cmd run verify:queenbee:selection`", "when core wins, when async wins, when node wins"])
	const reverseEngineeringDocsPresent =
		includesAll(reverseEngineeringMapText, [
			"## Session 225 Async, Node, And Parallel-Pressure Answer",
			"`JSTSAsyncBee` is now explicitly part of the truthful answer for async-sensitive bounded rows",
			"`bounded_node_cli_task` is now explicitly green on `JSTSNodeBee`",
		]) &&
		includesAll(canonicalTaskText, [
			"## Session 225 Async, Node, And Parallel-Pressure Answer",
			"`QB-CAN-06` and `QB-CAN-07` are now explicitly green with specialist-envelope fit and singleton queue answers recorded instead of guessed",
		]) &&
		includesAll(envelopesText, [
			"## Session 225 Specialist Envelope Reading",
			"`JSTSAsyncBee` and `JSTSNodeBee` still stay behind the existing `queenbee.jsts_coder.001` route slot",
		]) &&
		includesAll(parallelModelText, [
			"## Session 225 Reverse-Engineering Reading",
			"same-assignment multi-coder fan-out remains rejected",
		]) &&
		includesAll(taskCorpusText, [
			"## Session 225 QueenBee Async, Node, And Parallel-Pressure Note",
			"current clone-worker talk stays deferred until a later row proves explicit slice ownership and deterministic fan-in value",
		]) &&
		includesAll(architectureText, [
			"## Decision: Session 225 keeps async, Node, and first parallel-pressure rows on singleton specialist handling",
			"**Session:** 225",
		]) &&
		includesAll(verificationCatalogText, [
			"the Session 225 async, Node, and parallel-pressure reverse-engineering answer now records",
			"`bounded_two_file_update` and `bounded_node_cli_task` as singleton specialist rows",
		])
	const packageScriptPresent = packageJson.scripts?.["verify:queenbee:selection"] === "npm run build && node dist/verification/verify_queenbee_selection.js"

	const fixture = await createTempTestRepoCopy(rootDir, "queenbee-selection")
	try {
		const utilsPath = path.join(fixture.repoPath, "utils.ts")
		const sourcePath = path.join(fixture.repoPath, "src", "format.ts")
		const testPath = path.join(fixture.repoPath, "src", "format.test.ts")
		const refactorLeftPath = path.join(fixture.repoPath, "src", "refactor_left.ts")
		const refactorRightPath = path.join(fixture.repoPath, "src", "refactor_right.ts")
		const beforeUtils = fs.readFileSync(utilsPath, "utf8")
		fs.mkdirSync(path.dirname(sourcePath), { recursive: true })
		fs.writeFileSync(
			utilsPath,
			`${beforeUtils}\nexport async function retryLater(delayMs: number): Promise<string> {\n\tawait new Promise((resolve) => setTimeout(resolve, delayMs))\n\treturn "later"\n}\n`,
			"utf8",
		)
		fs.writeFileSync(
			sourcePath,
			`export function formatLine(input: string): string {\n\treturn input.trim().toUpperCase()\n}\n`,
			"utf8",
		)
		fs.writeFileSync(
			testPath,
			`import { formatLine } from "./format"\n\nexport function expectFormat(): string {\n\treturn formatLine(" hello ")\n}\n`,
			"utf8",
		)
		fs.writeFileSync(refactorLeftPath, `export const leftValue = "left"\n`, "utf8")
		fs.writeFileSync(refactorRightPath, `export const rightValue = "right"\n`, "utf8")

		const shell = createQueenBeeShell({ workspaceRoot: fixture.repoPath })
		const specialistList = shell.coder.listAvailableSpecialists()
		const specialistListVisible =
			specialistList.join(",") === "JSTSCoreBee,JSTSAsyncBee,JSTSNodeBee,JSTSTestBee,JSTSRefactorBee"

		const plainEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-core",
			missionId: "mission-selection-1",
			assignmentId: "assign-selection-1",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:30:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: core plain" to hello.ts',
				taskFamily: "comment_file",
				languagePack: "js_ts",
				allowedFiles: ["hello.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "small_named_file_comment",
				plannerSummary: "PlannerBee emitted 1 assignment packet for comment_file over hello.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const asyncEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-async",
			missionId: "mission-selection-2",
			assignmentId: "assign-selection-2",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:31:00Z",
			payload: {
				task: "update utils.ts while keeping the async retry timeout path explicit",
				taskFamily: "update_named_file",
				languagePack: "js_ts",
				allowedFiles: ["utils.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "single_named_file_update",
				plannerSummary: "PlannerBee emitted 1 assignment packet for update_named_file over utils.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const nodeEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-node",
			missionId: "mission-selection-3",
			assignmentId: "assign-selection-3",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:32:00Z",
			payload: {
				task: 'add the exact comment "// queenbee: node cli hello" to hello.ts and add a npm run cli entry for hello.ts',
				taskFamily: "bounded_node_cli_task",
				languagePack: "js_ts",
				allowedFiles: ["package.json", "hello.ts"],
				forbiddenFiles: ["utils.ts"],
				expectedResult: "bounded_node_cli_task",
				plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_node_cli_task over package.json, hello.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const testEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-test",
			missionId: "mission-selection-4",
			assignmentId: "assign-selection-4",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:32:30Z",
			payload: {
				task: 'update src/format.ts and src/format.test.ts so both files include the exact comment "// queenbee: test specialist".',
				taskFamily: "update_file_and_test",
				languagePack: "js_ts",
				allowedFiles: ["src/format.ts", "src/format.test.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "update_file_and_test",
				plannerSummary: "PlannerBee emitted 1 assignment packet for update_file_and_test over src/format.ts, src/format.test.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const refactorEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-refactor",
			missionId: "mission-selection-5",
			assignmentId: "assign-selection-5",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:32:45Z",
			payload: {
				task: 'update src/refactor_left.ts and src/refactor_right.ts together so both files include the exact comment "// queenbee: refactor specialist".',
				taskFamily: "bounded_two_file_update",
				languagePack: "js_ts",
				allowedFiles: ["src/refactor_left.ts", "src/refactor_right.ts"],
				forbiddenFiles: ["package.json"],
				expectedResult: "bounded_two_file_update",
				plannerSummary:
					"PlannerBee emitted 1 assignment packet for bounded_two_file_update over src/refactor_left.ts, src/refactor_right.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})
		const tooWideNodeEnvelope = buildQueenBeeEnvelope({
			messageId: "msg-selection-node-too-wide",
			missionId: "mission-selection-4",
			assignmentId: "assign-selection-4",
			senderBeeId: "queenbee.router.001",
			recipientBeeId: "queenbee.jsts_coder.001",
			messageType: "assignment_packet",
			timestamp: "2026-03-27T11:33:00Z",
			payload: {
				task: "update package.json, hello.ts, and utils.ts for one cli task",
				taskFamily: "bounded_node_cli_task",
				languagePack: "js_ts",
				allowedFiles: ["package.json", "hello.ts", "utils.ts"],
				forbiddenFiles: [],
				expectedResult: "bounded_node_cli_task",
				plannerSummary: "PlannerBee emitted 1 assignment packet for bounded_node_cli_task over package.json, hello.ts, utils.ts.",
				requiresReview: true,
				requiresVerification: true,
			},
		})

		const coreSelection = shell.coder.selectSpecialistForEnvelope(plainEnvelope)
		const asyncSelection = shell.coder.selectSpecialistForEnvelope(asyncEnvelope)
		const nodeSelection = shell.coder.selectSpecialistForEnvelope(nodeEnvelope)
		const testSelection = shell.coder.selectSpecialistForEnvelope(testEnvelope)
		const refactorSelection = shell.coder.selectSpecialistForEnvelope(refactorEnvelope)
		const asyncResult = shell.coder.codeAssignment(asyncEnvelope)
		const nodeResult = shell.coder.codeAssignment(nodeEnvelope)
		const testResult = shell.coder.codeAssignment(testEnvelope)
		const refactorResult = shell.coder.codeAssignment(refactorEnvelope)
		const tooWideNodeResult = shell.coder.codeAssignment(tooWideNodeEnvelope)

		const coreWinsPlainTask = coreSelection === "JSTSCoreBee"
		const asyncWinsAsyncTask = asyncSelection === "JSTSAsyncBee" && asyncResult.accepted === true && asyncResult.coderSummary.includes("JSTSAsyncBee")
		const nodeWinsNodeTask =
			nodeSelection === "JSTSNodeBee" &&
			nodeResult.accepted === true &&
			nodeResult.coderSummary.includes("JSTSNodeBee") &&
			nodeResult.changedFiles.join(",") === "package.json,hello.ts"
		const testWinsFileAndTestTask =
			testSelection === "JSTSTestBee" &&
			testResult.accepted === true &&
			testResult.coderSummary.includes("JSTSTestBee") &&
			testResult.changedFiles.join(",") === "src/format.ts,src/format.test.ts"
		const refactorWinsTwoFileTask =
			refactorSelection === "JSTSRefactorBee" &&
			refactorResult.accepted === true &&
			refactorResult.coderSummary.includes("JSTSRefactorBee") &&
			refactorResult.changedFiles.join(",") === "src/refactor_left.ts,src/refactor_right.ts"
		const selectionStayedBounded =
			specialistList.join(",") === "JSTSCoreBee,JSTSAsyncBee,JSTSNodeBee,JSTSTestBee,JSTSRefactorBee" &&
			asyncEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			nodeEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			testEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			refactorEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			tooWideNodeResult.accepted === false &&
			tooWideNodeResult.reason === "coder_target_count_out_of_bounds"
		const clonePolicyStayedSingleton =
			reverseEngineeringDocsPresent &&
			plainEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			asyncEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			nodeEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			testEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			refactorEnvelope.recipientBeeId === "queenbee.jsts_coder.001" &&
			!shell.registeredBeeIds
				.map((beeId) => String(beeId))
				.some(
					(beeId) =>
						beeId === "queenbee.jsts_async.001" ||
						beeId === "queenbee.jsts_node.001" ||
						beeId === "queenbee.jsts_test.001" ||
						beeId === "queenbee.jsts_refactor.001",
				)

		details.push(
			`specialists=${specialistList.join(",") || "missing"}`,
			`coreSelection=${coreSelection}`,
			`asyncSelection=${asyncSelection}`,
			`nodeSelection=${nodeSelection}`,
			`testSelection=${testSelection}`,
			`refactorSelection=${refactorSelection}`,
			`asyncSummary=${asyncResult.coderSummary}`,
			`nodeSummary=${nodeResult.coderSummary}`,
			`testSummary=${testResult.coderSummary}`,
			`refactorSummary=${refactorResult.coderSummary}`,
			`tooWideNodeReason=${String(tooWideNodeResult.reason ?? "missing")}`,
		)

		return {
			selectionDocsPresent,
			reverseEngineeringDocsPresent,
			packageScriptPresent,
			specialistListVisible,
			coreWinsPlainTask,
			asyncWinsAsyncTask,
			nodeWinsNodeTask,
			testWinsFileAndTestTask,
			refactorWinsTwoFileTask,
			selectionStayedBounded,
			clonePolicyStayedSingleton,
			details,
		}
	} finally {
		fixture.cleanup()
	}
}

export function formatQueenBeeSelectionHarnessResult(result: QueenBeeSelectionHarnessResult): string {
	return [
		`Selection docs present: ${result.selectionDocsPresent ? "PASS" : "FAIL"}`,
		`Reverse-engineering docs present: ${result.reverseEngineeringDocsPresent ? "PASS" : "FAIL"}`,
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Specialist list visible: ${result.specialistListVisible ? "PASS" : "FAIL"}`,
		`Core wins plain task: ${result.coreWinsPlainTask ? "PASS" : "FAIL"}`,
		`Async wins async task: ${result.asyncWinsAsyncTask ? "PASS" : "FAIL"}`,
		`Node wins node task: ${result.nodeWinsNodeTask ? "PASS" : "FAIL"}`,
		`Test wins file-and-test task: ${result.testWinsFileAndTestTask ? "PASS" : "FAIL"}`,
		`Refactor wins two-file task: ${result.refactorWinsTwoFileTask ? "PASS" : "FAIL"}`,
		`Selection stayed bounded: ${result.selectionStayedBounded ? "PASS" : "FAIL"}`,
		`Clone policy stayed singleton: ${result.clonePolicyStayedSingleton ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runQueenBeeSelectionHarness()
	console.log(formatQueenBeeSelectionHarnessResult(result))
	process.exit(
		result.selectionDocsPresent &&
			result.reverseEngineeringDocsPresent &&
			result.packageScriptPresent &&
			result.specialistListVisible &&
			result.coreWinsPlainTask &&
			result.asyncWinsAsyncTask &&
			result.nodeWinsNodeTask &&
			result.testWinsFileAndTestTask &&
			result.refactorWinsTwoFileTask &&
			result.selectionStayedBounded &&
			result.clonePolicyStayedSingleton
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:queenbee:selection] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
