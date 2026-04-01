import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { setTimeout as delay } from "timers/promises"

import { WorkspaceLock } from "../src/safety/WorkspaceLock"
import { StubModelClient } from "../src/model/StubModelClient"
import { TelemetryModelClient } from "../src/model/TelemetryModelClient"
import { DatabaseService } from "../src/db/DatabaseService"
import { MessageBus } from "../src/mail/MessageBus"
import { BaseAgent } from "../src/agents/BaseAgent"
import { BuilderAgent } from "../src/agents/BuilderAgent"
import { ReviewerAgent } from "../src/agents/ReviewerAgent"
import { CoordinatorAgent } from "../src/agents/CoordinatorAgent"
import { SupervisorAgent } from "../src/agents/SupervisorAgent"
import { MergerAgent } from "../src/agents/MergerAgent"
import { Orchestrator } from "../src/Orchestrator"
import { buildShellAdmissionSpec, buildShellIncidentCommandSpec, buildShellLaunchSpec, readShellSnapshot } from "../src/shell/ThinShell"
import { WorktreeManager } from "../src/worktree/WorktreeManager"
import { WatchdogDaemon } from "../src/watchdog/WatchdogDaemon"
import { CommandGate } from "../src/safety/CommandGate"
import {
	HEAD_TO_HEAD_STUDY_RELATIVE_PATH,
	HEAD_TO_HEAD_STUDY_TEMPLATE_RELATIVE_PATH,
	buildHeadToHeadBenchmarkMatrix,
	buildHeadToHeadBenchmarkReport,
	buildHeadToHeadStudyTemplate,
	formatHeadToHeadBenchmarkReport,
} from "../src/benchmark/HeadToHeadBenchmark"
import { formatQueenBeeSmallComparisonHarnessResult, runQueenBeeSmallComparisonHarness } from "./benchmark_queenbee_small"
import { formatQueenBeeTwoFileComparisonHarnessResult, runQueenBeeTwoFileComparisonHarness } from "./benchmark_queenbee_two_file"
import { formatQueenBeeBetaGateHarnessResult, runQueenBeeBetaGateHarness } from "./verify_queenbee_beta_gate"
import { formatQueenBeeControlStackHarnessResult, runQueenBeeControlStackHarness } from "./verify_queenbee_control_stack"
import { formatQueenBeeGateOneHarnessResult, runQueenBeeGateOneHarness } from "./verify_queenbee_gate1"
import { formatPublicPackBrandingHarnessResult, runPublicPackBrandingHarness } from "./verify_public_pack_branding"
import { formatPublicPackExportHarnessResult, runPublicPackExportHarness } from "./verify_public_pack_export"
import { formatPublicPackIssueTemplatesHarnessResult, runPublicPackIssueTemplatesHarness } from "./verify_public_pack_issue_templates"
import { formatPublicPackOnboardingHarnessResult, runPublicPackOnboardingHarness } from "./verify_public_pack_onboarding"
import { formatPublicPackQuickstartHarnessResult, runPublicPackQuickstartHarness } from "./verify_public_pack_quickstart"
import { formatPublicPackReadmeHarnessResult, runPublicPackReadmeHarness } from "./verify_public_pack_readme"
import { formatPublicPackReleaseDocsHarnessResult, runPublicPackReleaseDocsHarness } from "./verify_public_pack_release_docs"
import { formatPublicPackScaffoldHarnessResult, runPublicPackScaffoldHarness } from "./verify_public_pack_scaffold"
import { BASIC_VERIFICATION_TASKS, formatVerificationResults, runBasicVerification } from "./verify_live_basic"
import { classifyStopReason, formatForensicsReport } from "./forensics_latest"
import { formatMatrixForensicsReport, groupMatrixFailures } from "./forensics_matrix_latest"
import { LIVE_MATRIX_TASKS, validateLiveMatrixTasks } from "./live_matrix_tasks"
import { findNamedBaselineCommit, formatMatrixResults, runFixedMatrix } from "./verify_live_matrix"
import { formatBetaForensicsReport, groupBetaFailures } from "./forensics_beta_latest"
import { BETA_MATRIX_TASKS, validateBetaMatrixTasks } from "./beta_matrix_tasks"
import { evaluateBetaRow, formatBetaResults, isolateBetaRunRows, summarizeBetaRun } from "./verify_live_beta"
import { formatAcceptanceFixtureResults, runAcceptanceFixtures } from "./verify_acceptance_gates"
import { formatProviderResilienceResults, runProviderResilienceFixtures } from "./verify_provider_resilience"
import { formatRecoveryHarnessResult, runRecoveryHarness } from "./verify_recovery"
import { formatAdmissionHarnessResult, runAdmissionHarness } from "./verify_admission"
import { formatProfilesHarnessResult, runProfilesHarness } from "./verify_profiles"
import { formatGuardrailsHarnessResult, runGuardrailsHarness } from "./verify_guardrails"
import { formatReviewQueueHarnessResult, runReviewQueueHarness } from "./verify_review_queue"
import { formatTaskTemplateHarnessResult, runTaskTemplateHarness } from "./verify_task_templates"
import { formatProofBundleResult, proofBundlePassed } from "./ProofBundles"
import { formatOwnerProviderDefaultsHarnessResult, runOwnerProviderDefaultsHarness } from "./verify_owner_provider_defaults"
import { formatOwnerBetaFixturesHarnessResult, runOwnerBetaFixturesHarness } from "./verify_owner_beta_fixtures"
import { formatOwnerCacheHarnessResult, runOwnerCacheHarness } from "./verify_owner_cache"
import { formatOwnerTaskLibraryHarnessResult, runOwnerTaskLibraryHarness } from "./verify_owner_task_library"
import { formatTaskCorpusHarnessResult, runTaskCorpusHarness } from "./verify_task_corpus"
import { formatOwnerQuickActionsHarnessResult, runOwnerQuickActionsHarness } from "./verify_owner_quick_actions"
import { formatIncidentTriageHarnessResult, runIncidentTriageHarness } from "./verify_incident_triage"
import { formatOwnerLifeSignalHarnessResult, runOwnerLifeSignalHarness } from "./verify_owner_life_signal"
import { formatTaskComposerHarnessResult, runTaskComposerHarness } from "./verify_task_composer"
import { formatOwnerClarityHarnessResult, runOwnerClarityHarness } from "./verify_owner_clarity"
import { formatOwnerOnboardingHarnessResult, runOwnerOnboardingHarness } from "./verify_owner_onboarding"
import { formatDemoRunHarnessResult, runDemoRunHarness } from "./verify_demo_run"
import { formatPlanSchemaHarnessResult, runPlanSchemaHarness } from "./verify_plan_schema"
import { formatAssignmentLedgerHarnessResult, runAssignmentLedgerHarness } from "./verify_assignment_ledger"
import { formatProgressMapHarnessResult, runProgressMapHarness } from "./verify_progress_map"
import { formatReplayExportHarnessResult, runReplayExportHarness } from "./verify_replay_export"
import { formatCompletionLedgerHarnessResult, runCompletionLedgerHarness } from "./verify_completion_ledger"
import { formatAskSiblingHarnessResult, runAskSiblingHarness } from "./verify_ask_sibling"
import { formatCriticLaneHarnessResult, runCriticLaneHarness } from "./verify_critic_lane"
import { formatCheckpointHarnessResult, runCheckpointHarness } from "./verify_checkpoints"
import { formatResumeHarnessResult, runResumeHarness } from "./verify_resume"
import { formatRepoMapHarnessResult, runRepoMapHarness } from "./verify_repo_map"
import { formatRoleManualHarnessResult, runRoleManualHarness } from "./verify_role_manuals"
import { formatContextPackHarnessResult, runContextPackHarness } from "./verify_context_packs"
import { formatPatternMemoryHarnessResult, runPatternMemoryHarness } from "./verify_pattern_memory"
import { formatMediumLaneHarnessResult, runMediumLaneHarness } from "./verify_lane_medium"
import { formatRetryPlannerHarnessResult, runRetryPlannerHarness } from "./verify_retry_planner"
import { formatRetrySnapshotHarnessResult, runRetrySnapshotHarness } from "./verify_retry_snapshots"
import { formatMergeOrderHarnessResult, runMergeOrderHarness } from "./verify_merge_order"
import { formatPostMergeQualityHarnessResult, runPostMergeQualityHarness } from "./verify_post_merge_quality"
import { formatOwnerLauncherHarnessResult, runOwnerLauncherHarness } from "../src/owner/VerifyOwnerLauncher"
import { formatOwnerProfileManifestHarnessResult, runOwnerProfileManifestHarness } from "../src/owner/VerifyOwnerProfileManifest"
import { formatOwnerSurfaceHarnessResult, runOwnerSurfaceHarness } from "./verify_owner_surface"
import { formatRc1OpsHarnessResult, runRc1OpsHarness } from "./verify_rc1_ops"
import {
	DEFAULT_DAILY_DRIVER_RULES,
	evaluateDailyDriverLog,
	evaluateRecordedProofGate,
	formatRc1StatusResult,
	formatRc1VerificationResult,
	runRc1Status,
} from "../src/release/Rc1Gate"
import { recordDailyDriverFromSummaryPath } from "../src/release/Rc1Ops"
import {
	buildVscodeShellSmokeEnv,
	formatVscodeShellSmokeResult,
	writeVscodeShellSmokeRequest,
} from "./verify_vscode_shell_smoke"
import { formatQueenBeeBetaContractHarnessResult, runQueenBeeBetaContractHarness } from "./verify_queenbee_beta_contract"
import { formatQueenBeeJstsAsyncHarnessResult, runQueenBeeJstsAsyncHarness } from "./verify_queenbee_jsts_async"
import { formatQueenBeeBoundedNodeHarnessResult, runQueenBeeBoundedNodeHarness } from "./verify_queenbee_bounded_node"
import { formatQueenBeeJstsCoreHarnessResult, runQueenBeeJstsCoreHarness } from "./verify_queenbee_jsts_core"
import { formatQueenBeeJstsFileAndTestHarnessResult, runQueenBeeJstsFileAndTestHarness } from "./verify_queenbee_jsts_file_and_test"
import { formatQueenBeeJstsNodeHarnessResult, runQueenBeeJstsNodeHarness } from "./verify_queenbee_jsts_node"
import { formatQueenBeeJstsRenameHarnessResult, runQueenBeeJstsRenameHarness } from "./verify_queenbee_jsts_rename"
import { formatQueenBeeRouterHarnessResult, runQueenBeeRouterHarness } from "./verify_queenbee_router"
import { formatQueenBeeSelectionHarnessResult, runQueenBeeSelectionHarness } from "./verify_queenbee_selection"
import { formatQueenBeeUxHarnessResult, runQueenBeeUxHarness } from "./verify_queenbee_ux"
import { chooseInitialShellWorkspace } from "../src/vscode_shell/WorkspaceDefaults"
import { createTempTestRepoCopy, resetBuiltInTestWorkspace, TEST_WORKSPACE_BASELINE } from "./test_workspace_baseline"
import { initializeRunGuardrails, GuardrailError, readRunGuardrailUsage } from "../src/run/RunGuardrails"
import { appendRunEvent, ensureRunDir, readRunEvents, writeRunSummary } from "../src/run/RunArtifacts"
import { evaluateTaskAdmission } from "../src/run/AdmissionGate"
import { listWorkspaceFilesForDiscovery } from "../src/run/SemiOpenDiscovery"
import { normalizeProviderError } from "../src/model/ProviderFailure"

const ROOT = (() => {
	const candidate = path.join(__dirname, "..")
	if (fs.existsSync(path.join(candidate, "package.json"))) return candidate
	return path.join(candidate, "..")
})()
const TEST_WORKSPACE = path.join(ROOT, "verification", "test_workspace")

interface TestResult {
	name: string
	passed: boolean
	output: string
	durationMs: number
}

const results: TestResult[] = []

async function runCommandCapture(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`
	const stdoutPath = path.join(ROOT, "verification", `.tmp-cmd-${stamp}.stdout.log`)
	const stderrPath = path.join(ROOT, "verification", `.tmp-cmd-${stamp}.stderr.log`)

	const stdoutFd = fs.openSync(stdoutPath, "w")
	const stderrFd = fs.openSync(stderrPath, "w")

	try {
		const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", stdoutFd, stderrFd] })

		const killTree = () => {
			if (!child.pid) return
			if (process.platform === "win32") {
				try {
					spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
				} catch {
					// ignore
				}
				return
			}
			try {
				child.kill("SIGTERM")
			} catch {
				// ignore
			}
		}

		const timeout = setTimeout(() => killTree(), options.timeoutMs)
		timeout.unref?.()

		const code = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject)
			child.once("close", (c) => resolve(typeof c === "number" ? c : null))
		}).finally(() => clearTimeout(timeout))

		const stdout = fs.readFileSync(stdoutPath, "utf8")
		const stderr = fs.readFileSync(stderrPath, "utf8")
		return { stdout, stderr, code }
	} finally {
		try {
			fs.closeSync(stdoutFd)
		} catch {
			// ignore
		}
		try {
			fs.closeSync(stderrFd)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stdoutPath)
		} catch {
			// ignore
		}
		try {
			fs.unlinkSync(stderrPath)
		} catch {
			// ignore
		}
	}
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
	const start = Date.now()
	try {
		await fn()
		results.push({ name, passed: true, output: "OK", durationMs: Date.now() - start })
		console.log(`  PASS - ${name} (${Date.now() - start}ms)`)
	} catch (err) {
		const output = err instanceof Error ? err.message : String(err)
		results.push({ name, passed: false, output, durationMs: Date.now() - start })
		console.log(`  FAIL - ${name}\n     ${output}`)
	}
}

function createOrchestratorHarness(dryRun = true): {
	orchestrator: Orchestrator
	db: DatabaseService
	dbPath: string
	cleanup: () => void
} {
	DatabaseService.reset()
	const dbPath = path.join(ROOT, "verification", `.tmp-orchestrator-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
	const db = DatabaseService.getInstance(dbPath)
	const orchestrator = new Orchestrator(TEST_WORKSPACE, db, dryRun)

	return {
		orchestrator,
		db,
		dbPath,
		cleanup: () => {
			db.close()
			DatabaseService.reset()
			if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		},
	}
}

async function createTempRepoCopy(name: string): Promise<{ repoPath: string; cleanup: () => void }> {
	return await createTempTestRepoCopy(ROOT, name)
}

function createFixtureRepo(
	name: string,
	files: Record<string, string>,
): { repoPath: string; cleanup: () => void } {
	const repoPath = path.join(ROOT, "verification", `.tmp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	for (const [relPath, content] of Object.entries(files)) {
		const filePath = path.join(repoPath, relPath)
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		fs.writeFileSync(filePath, content, "utf8")
	}
	return {
		repoPath,
		cleanup: () => {
			if (fs.existsSync(repoPath)) fs.rmSync(repoPath, { recursive: true, force: true })
		},
	}
}

async function main(): Promise<void> {
	// Level 1 Tests (no LLM, no network, must complete in < 30s)
	console.log("\n===================================")
	console.log("  SwarmCoder V2 - Level 1 Tests")
	console.log("===================================\n")
	await resetBuiltInTestWorkspace(ROOT)

	await runTest("WorkspaceLock: blocks path outside workspace", () => {
		WorkspaceLock.setRoot(TEST_WORKSPACE)
		let threw = false
		try {
			WorkspaceLock.validatePath("C:\\Windows\\System32\\evil.txt")
		} catch {
			threw = true
		}
		if (!threw) throw new Error("WorkspaceLock did NOT block path outside workspace - critical safety failure")
	})

	await runTest("WorkspaceLock: allows path inside workspace", () => {
		WorkspaceLock.setRoot(TEST_WORKSPACE)
		// Should not throw
		WorkspaceLock.validatePath(path.join(TEST_WORKSPACE, "hello.ts"))
	})

	await runTest("StubModelClient: returns fixture response", async () => {
		const client = new StubModelClient("coordinator_classify")
		const response = await client.chat([{ role: "user", content: "classify" }])
		const parsed = JSON.parse(response) as { complexity: string }
		if (!parsed.complexity) throw new Error(`Expected complexity in response, got: ${response}`)
	})

	await runTest("StubModelClient: throws on missing fixture", async () => {
		const client = new StubModelClient("fixture_that_does_not_exist_xyz")
		let threw = false
		try {
			await client.chat([{ role: "user", content: "test" }])
		} catch (err) {
			if (err instanceof Error && err.message.includes("StubFixtureNotFound")) threw = true
		}
		if (!threw) throw new Error("StubModelClient should throw StubFixtureNotFound for missing fixture")
	})

	await runTest("TelemetryModelClient: estimated usage budget fails closed after an over-budget response", async () => {
		const workspace = await createTempRepoCopy("telemetry-usage-budget")
		DatabaseService.reset()
		const dbPath = path.join(workspace.repoPath, ".swarm", "telemetry-usage-budget.db")
		const db = DatabaseService.getInstance(dbPath)
		const taskId = `task-telemetry-budget-${Date.now()}`
		const runDir = ensureRunDir(workspace.repoPath, taskId)

		try {
			initializeRunGuardrails(db, taskId, { maxModelCalls: 4, maxEstimatedTokens: 8 })
			const client = new TelemetryModelClient(
				{
					chat: async () => "this response is long enough to exceed the tiny budget",
				},
				{
					runDir,
					actor: "telemetry-budget-test",
					maxCalls: 4,
					maxEstimatedTokens: 8,
					db,
					taskId,
				},
			)

			let threw = false
			try {
				await client.chat([{ role: "user", content: "1234567890123456" }])
			} catch (err) {
				if (err instanceof GuardrailError && err.code === "usage_budget_ceiling") {
					threw = true
				}
			}

			if (!threw) throw new Error("Expected TelemetryModelClient to throw usage_budget_ceiling")

			const usage = readRunGuardrailUsage(db, taskId)
			if (!usage) throw new Error("Expected run guardrail usage to exist")
			if (usage.estimatedTokensUsed <= usage.maxEstimatedTokens) {
				throw new Error(`Expected estimatedTokensUsed to exceed limit, got ${usage.estimatedTokensUsed}/${usage.maxEstimatedTokens}`)
			}

			const events = readRunEvents(runDir)
			const ceilingEvent = events.find((event) => event.type === "ceiling_reached" && event.ceiling === "estimated_usage_tokens")
			if (!ceilingEvent) throw new Error("Expected a ceiling_reached event for estimated usage tokens")
		} finally {
			db.close()
			DatabaseService.reset()
			workspace.cleanup()
		}
	})

	await runTest("CoordinatorAgent: classifies SIMPLE task correctly", async () => {
		const stub = new StubModelClient("coordinator_classify")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classify("add a comment to hello.ts", ["hello.ts", "utils.ts"])
		if (result !== "SIMPLE") throw new Error(`Expected SIMPLE, got: ${result}`)
	})

	await runTest("CoordinatorAgent: classifies COMPLEX task correctly", async () => {
		const stub = new StubModelClient("coordinator_classify_complex")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classify("refactor utils.ts and update hello.ts to match", ["hello.ts", "utils.ts"])
		if (result !== "COMPLEX") throw new Error(`Expected COMPLEX, got: ${result}`)
	})

	await runTest("CoordinatorAgent: routes explicit one-file create task to small_task without model", async () => {
		const stub = new StubModelClient("coordinator_classify_complex")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classifyDetailed("create hello.py with hello world", ["hello.ts", "utils.ts"])
		if (result.path !== "small_task") throw new Error(`Expected small_task path, got: ${result.path}`)
		if (result.usedModel) throw new Error("Expected one-file create task to bypass model classification")
		if (result.targetFiles[0] !== "hello.py") throw new Error(`Expected target hello.py, got: ${result.targetFiles.join(", ")}`)
	})

	await runTest("CoordinatorAgent: routes explicit one-file edit task to small_task without model", async () => {
		const stub = new StubModelClient("coordinator_classify_complex")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classifyDetailed("add a comment to hello.ts", ["hello.ts", "utils.ts"])
		if (result.path !== "small_task") throw new Error(`Expected small_task path, got: ${result.path}`)
		if (result.targetFiles[0] !== "hello.ts") throw new Error(`Expected target hello.ts, got: ${result.targetFiles.join(", ")}`)
	})

	await runTest("CoordinatorAgent: uses model classification for ambiguous task", async () => {
		const stub = new StubModelClient("coordinator_classify")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classifyDetailed("improve the greeting flow", ["hello.ts", "utils.ts"])
		if (!result.usedModel) throw new Error("Expected ambiguous task to use model classification")
	})

	await runTest("CoordinatorAgent: routes explicit 3-file task to scoped path without model", async () => {
		const stub = new StubModelClient("coordinator_classify_complex")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classifyDetailed(
			"update hello.ts, utils.ts, and package.json together",
			["hello.ts", "utils.ts", "package.json"],
		)
		if (result.path !== "scoped") throw new Error(`Expected scoped path, got: ${result.path}`)
		if (result.usedModel) throw new Error("Expected explicit 3-file task to bypass model classification")
		if (result.targetFiles.length !== 3) throw new Error(`Expected 3 target files, got: ${result.targetFiles.length}`)
	})

	await runTest("CoordinatorAgent: preserves explicit missing target files in scoped routing", async () => {
		const stub = new StubModelClient("coordinator_classify_complex")
		const coordinator = new CoordinatorAgent(stub)
		const result = await coordinator.classifyDetailed(
			"update hello.ts, utils.ts, and notes.md together",
			["hello.ts", "utils.ts", "package.json"],
		)
		if (result.path !== "scoped") throw new Error(`Expected scoped path, got: ${result.path}`)
		if (result.usedModel) throw new Error("Expected explicit multi-file task to bypass model classification")
		if (result.targetFiles.join(",") !== "hello.ts,utils.ts,notes.md") {
			throw new Error(`Expected explicit target files to be preserved, got: ${result.targetFiles.join(", ")}`)
		}
	})

	await runTest("CoordinatorAgent: routes helper-plus-test task to semi_open without model", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-helper", {
			"src/format.ts": 'export function formatBanner(input: string): string {\n\treturn input\n}\n',
			"tests/format.test.ts": 'import { formatBanner } from "../src/format"\n\nexport const baseline = formatBanner("ok")\n',
		})
		try {
			const stub = new StubModelClient("coordinator_classify_complex")
			const coordinator = new CoordinatorAgent(stub)
			const files = listWorkspaceFilesForDiscovery(fixtureRepo.repoPath)
			const result = await coordinator.classifyDetailed(
				'update src/format.ts and keep its test aligned so both files include the exact comment "// semi-open: helper sync".',
				files,
				{
					workspaceRoot: fixtureRepo.repoPath,
				},
			)
			if (result.path !== "semi_open") throw new Error(`Expected semi_open path, got: ${result.path}`)
			if (result.usedModel) throw new Error("Expected helper-plus-test task to bypass model classification")
			if (result.targetFiles.join(",") !== "src/format.ts,tests/format.test.ts") {
				throw new Error(`Unexpected helper-plus-test target files: ${result.targetFiles.join(", ")}`)
			}
			if (result.taskContract?.derivation?.taskClass !== "helper_test") {
				throw new Error(`Expected helper_test derivation, got: ${String(result.taskContract?.derivation?.taskClass)}`)
			}
			const snippets = result.taskContract?.acceptance?.requiredContentSnippets ?? []
			if (snippets.length !== 2 || !snippets.every((entry) => entry.snippet === "// semi-open: helper sync")) {
				throw new Error(`Expected helper-test literal requirements for both files, got: ${JSON.stringify(snippets)}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("CoordinatorAgent: routes docs-sync task to semi_open without model", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-docs", {
			"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
			"README.md": "# Config Repo\n",
		})
		try {
			const stub = new StubModelClient("coordinator_classify_complex")
			const coordinator = new CoordinatorAgent(stub)
			const files = listWorkspaceFilesForDiscovery(fixtureRepo.repoPath)
			const result = await coordinator.classifyDetailed(
				'sync the repo-root readme with src/config.ts by updating the readme so it contains the exact sentence "The config defaults stay documented in one place."',
				files,
				{
					workspaceRoot: fixtureRepo.repoPath,
				},
			)
			if (result.path !== "semi_open") throw new Error(`Expected semi_open path, got: ${result.path}`)
			if (result.taskContract?.derivation?.taskClass !== "docs_sync") {
				throw new Error(`Expected docs_sync derivation, got: ${String(result.taskContract?.derivation?.taskClass)}`)
			}
			const requiredTargets = result.taskContract?.scope?.requiredTargetFiles ?? []
			if (requiredTargets.join(",") !== "README.md") {
				throw new Error(`Expected docs sync to require README.md, got: ${requiredTargets.join(", ")}`)
			}
			const snippets = result.taskContract?.acceptance?.requiredContentSnippets ?? []
			if (snippets.length !== 1 || snippets[0]?.path !== "README.md" || snippets[0]?.snippet !== "The config defaults stay documented in one place.") {
				throw new Error(`Expected docs-sync literal requirement for README.md, got: ${JSON.stringify(snippets)}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("CoordinatorAgent: routes config-sync task to semi_open without model", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-config", {
			"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
			"config/defaults.json": '{\n  "mode": "safe"\n}\n',
		})
		try {
			const stub = new StubModelClient("coordinator_classify_complex")
			const coordinator = new CoordinatorAgent(stub)
			const files = listWorkspaceFilesForDiscovery(fixtureRepo.repoPath)
			const result = await coordinator.classifyDetailed(
				'sync the defaults json with src/config.ts so the config file contains the exact property "notes": "semi-open config sync".',
				files,
				{
					workspaceRoot: fixtureRepo.repoPath,
				},
			)
			if (result.path !== "semi_open") throw new Error(`Expected semi_open path, got: ${result.path}`)
			if (result.taskContract?.derivation?.taskClass !== "config_sync") {
				throw new Error(`Expected config_sync derivation, got: ${String(result.taskContract?.derivation?.taskClass)}`)
			}
			const requiredTargets = result.taskContract?.scope?.requiredTargetFiles ?? []
			if (requiredTargets.join(",") !== "config/defaults.json") {
				throw new Error(`Expected config sync to require config/defaults.json, got: ${requiredTargets.join(", ")}`)
			}
			const snippets = result.taskContract?.acceptance?.requiredContentSnippets ?? []
			if (snippets.length !== 1 || snippets[0]?.path !== "config/defaults.json" || snippets[0]?.snippet !== '"notes": "semi-open config sync"') {
				throw new Error(`Expected config-sync literal requirement for config/defaults.json, got: ${JSON.stringify(snippets)}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("CoordinatorAgent: routes rename-export task to semi_open with direct importers", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-rename", {
			"src/format.ts": 'export function formatBanner(input: string): string {\n\treturn input\n}\n',
			"src/index.ts": 'import { formatBanner } from "./format"\n\nexport const output = formatBanner("hi")\n',
			"src/format.test.ts": 'import { formatBanner } from "./format"\n\nexport const baseline = formatBanner("test")\n',
		})
		try {
			const stub = new StubModelClient("coordinator_classify_complex")
			const coordinator = new CoordinatorAgent(stub)
			const files = listWorkspaceFilesForDiscovery(fixtureRepo.repoPath)
			const result = await coordinator.classifyDetailed(
				"rename the export in src/format.ts and update its direct call sites",
				files,
				{ workspaceRoot: fixtureRepo.repoPath },
			)
			if (result.path !== "semi_open") throw new Error(`Expected semi_open path, got: ${result.path}`)
			if (result.targetFiles.join(",") !== "src/format.test.ts,src/format.ts,src/index.ts") {
				throw new Error(`Unexpected rename target files: ${result.targetFiles.join(", ")}`)
			}
			if (result.taskContract?.derivation?.taskClass !== "rename_export") {
				throw new Error(`Expected rename_export derivation, got: ${String(result.taskContract?.derivation?.taskClass)}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("AdmissionGate: refuses ambiguous semi-open docs discovery", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-ambiguous-docs", {
			"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
			"README.md": "# Config Repo\n",
			"docs/guide.md": "# Guide\n",
		})
		try {
			const result = evaluateTaskAdmission("sync the docs with src/config.ts", fixtureRepo.repoPath)
			if (result.decision !== "refuse") throw new Error(`Expected refuse decision, got: ${result.decision}`)
			if (!result.reasonCodes.includes("ambiguous_task_scope")) {
				throw new Error(`Expected ambiguous_task_scope reason, got: ${result.reasonCodes.join(", ")}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("AdmissionGate: refuses ambiguous semi-open config discovery", async () => {
		const fixtureRepo = createFixtureRepo("semiopen-ambiguous-config", {
			"src/config.ts": 'export const DEFAULT_MODE = "safe"\n',
			"config/defaults.json": '{\n  "mode": "safe"\n}\n',
			"config/settings.json": '{\n  "mode": "safe"\n}\n',
		})
		try {
			const result = evaluateTaskAdmission("sync the config with src/config.ts", fixtureRepo.repoPath)
			if (result.decision !== "refuse") throw new Error(`Expected refuse decision, got: ${result.decision}`)
			if (!result.reasonCodes.includes("ambiguous_task_scope")) {
				throw new Error(`Expected ambiguous_task_scope reason, got: ${result.reasonCodes.join(", ")}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("AdmissionGate: explicit config file stays admissible without semi-open pairing", async () => {
		const fixtureRepo = createFixtureRepo("explicit-config-target", {
			"config/defaults.json": '{\n  "mode": "safe"\n}\n',
		})
		try {
			const result = evaluateTaskAdmission(
				'update config/defaults.json so it contains the exact entry "betaMode": "external-beta"',
				fixtureRepo.repoPath,
			)
			if (result.decision === "refuse") throw new Error(`Expected explicit config target to be admitted, got: ${result.decision}`)
			if (result.reasonCodes.includes("ambiguous_task_scope")) {
				throw new Error(`Explicit config target should not be marked ambiguous: ${result.reasonCodes.join(", ")}`)
			}
			const requiredTargets = result.derivedTaskContract?.scope?.requiredTargetFiles ?? []
			if (requiredTargets.join(",") !== "config/defaults.json") {
				throw new Error(`Expected explicit config target to stay scoped to config/defaults.json, got: ${requiredTargets.join(", ")}`)
			}
		} finally {
			fixtureRepo.cleanup()
		}
	})

	await runTest("Orchestrator routing: explicit multi-file task bypasses supervisor and scopes subtasks to named files", async () => {
		const { repoPath, cleanup } = await createTempRepoCopy("deterministic-complex")
		DatabaseService.reset()
		const dbPath = path.join(repoPath, ".swarm", "deterministic-complex.db")
		const db = DatabaseService.getInstance(dbPath)
		try {
			const orchestrator = new Orchestrator(repoPath, db, true)
			const orch = orchestrator as any
			const seenActors: string[] = []
			let receivedSubtasks: Array<{ files?: string[] }> = []

			orch.createInlineModelClient = (actor: string) => {
				seenActors.push(actor)
				if (actor === "supervisor") throw new Error("Supervisor model should not be used for explicit multi-file routing")
				return new StubModelClient("coordinator_classify_complex")
			}
			orch.runComplexOnce = async (
				_runnerPath: string,
				_innerDbPath: string,
				_taskId: string,
				_baseRef: string,
				_task: string,
				subtasks: Array<{ files?: string[] }>,
			) => {
				receivedSubtasks = subtasks
				return { status: "done", message: "ok", stopReason: "success" }
			}

			const result = await orchestrator.run("update utils.ts and hello.ts together")
			if (result.status !== "done") throw new Error(`Expected done status, got: ${result.status}`)
			if (seenActors.includes("supervisor")) throw new Error("Supervisor path should have been bypassed")
			if (receivedSubtasks.length !== 1) {
				throw new Error(`Expected a single coordinated deterministic subtask, got: ${receivedSubtasks.length}`)
			}

			const receivedFiles = Array.from(
				new Set(
					receivedSubtasks.flatMap((subtask) =>
						Array.isArray(subtask.files) ? subtask.files.filter((file): file is string => typeof file === "string") : [],
					),
				),
			).sort()
			const expectedFiles = ["hello.ts", "utils.ts"]
			if (receivedFiles.join(",") !== expectedFiles.join(",")) {
				throw new Error(`Expected explicit target files only, got: ${receivedFiles.join(", ")}`)
			}
		} finally {
			db.close()
			DatabaseService.reset()
			cleanup()
		}
	})

	await runTest("SupervisorAgent: produces exactly builderCount subtasks with file lists", async () => {
		const stub = new StubModelClient("supervisor_plan")
		const supervisor = new SupervisorAgent(stub)
		const subtasks = await supervisor.plan("do two changes", ["hello.ts", "utils.ts"], 2)
		if (subtasks.length !== 2) throw new Error(`Expected 2 subtasks, got: ${subtasks.length}`)

		const seen = new Set<string>()
		for (const s of subtasks) {
			if (!s.assignedBuilder) throw new Error("Missing assignedBuilder")
			if (!Array.isArray(s.files) || s.files.length === 0) throw new Error("Subtask missing files list")
			for (const f of s.files) {
				if (seen.has(f)) throw new Error(`File overlap detected: ${f}`)
				seen.add(f)
			}
		}
	})

	await runTest("WorktreeManager: creates and removes worktree cleanly", async () => {
		const wm = new WorktreeManager(TEST_WORKSPACE)
		const branchName = "swarm/test-worktree"
		const worktreePath = path.join(ROOT, "verification", ".tmp-worktree-test")

		const cleanup = async () => {
			try {
				await wm.remove(worktreePath, true)
			} catch {
				// ignore
			}
			try {
				await wm.prune()
			} catch {
				// ignore
			}

			await runCommandCapture(
				"git",
				["-c", `safe.directory=${TEST_WORKSPACE}`, "branch", "-D", branchName],
				{ cwd: TEST_WORKSPACE, timeoutMs: 10_000 },
			)

			try {
				if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true })
			} catch {
				// ignore
			}
		}

		await cleanup()
		try {
			await wm.create(branchName, worktreePath, "HEAD")

			const dotGit = path.join(worktreePath, ".git")
			if (!fs.existsSync(dotGit)) throw new Error(`Expected worktree .git to exist at: ${dotGit}`)

			await wm.remove(worktreePath)
			await wm.prune()

			if (fs.existsSync(worktreePath)) throw new Error(`Worktree path still exists after remove: ${worktreePath}`)
		} finally {
			await cleanup()
		}
	})

	await runTest("DatabaseService: initializes and accepts queries", () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-test.db")
		const db = DatabaseService.getInstance(dbPath)
		db.run("INSERT INTO tasks (id, description) VALUES (?, ?)", ["test-1", "test task"])
		const row = db.get<{ description: string }>("SELECT description FROM tasks WHERE id = ?", ["test-1"])
		db.close()
		DatabaseService.reset()
		if (!row) throw new Error("DatabaseService: row not found after insert")
		if (row.description !== "test task") throw new Error("DatabaseService: wrong value")
		// Cleanup
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
	})

	await runTest("CommandGate: blocks risky install, branch, config, and dynamic node commands", () => {
		const blocked = ["npm install", "npm ci", "git checkout main", "git config user.name x", "node -e \"console.log(1)\""]
		for (const command of blocked) {
			const result = CommandGate.validate(command)
			if (result.allowed) throw new Error(`Expected blocked command: ${command}`)
		}
	})

	await runTest("CommandGate: allows the manifest-backed repo verify script prefix", () => {
		const result = CommandGate.validate("node scripts/verify.js")
		if (!result.allowed) {
			throw new Error(`Expected node scripts/verify.js to be allowed, got: ${result.reason ?? "blocked"}`)
		}
	})

	await runTest("WatchdogDaemon: detects stale agent and sends error to orchestrator", () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-watchdog-test.db")
		const db = DatabaseService.getInstance(dbPath)

		const agentId = "builder-stale-1"
		const lastHeartbeat = new Date(Date.now() - 3 * 60 * 1000).toISOString()
		db.run("INSERT OR REPLACE INTO agents (id, role, status, last_heartbeat) VALUES (?,?,?,?)", [
			agentId,
			"builder",
			"running",
			lastHeartbeat,
		])

		const watchdog = new WatchdogDaemon(db)
		watchdog.checkNow()

		const agent = db.get<{ status: string }>("SELECT status FROM agents WHERE id = ?", [agentId])
		if (!agent) throw new Error("Expected agent row to exist")
		if (agent.status !== "failed") throw new Error(`Expected stale agent to be marked failed, got: ${agent.status}`)

		const msg = db.get<{ from_agent: string; to_agent: string; type: string; payload: string }>(
			"SELECT from_agent,to_agent,type,payload FROM messages WHERE to_agent='orchestrator' AND type='error' ORDER BY id DESC LIMIT 1",
		)
		if (!msg) throw new Error("Expected watchdog to send an error message to orchestrator")
		if (msg.from_agent !== "watchdog") throw new Error(`Expected from_agent=watchdog, got: ${msg.from_agent}`)

		const payload = JSON.parse(msg.payload) as { agentId?: unknown; reason?: unknown; lastHeartbeat?: unknown }
		if (payload.agentId !== agentId) throw new Error(`Expected payload.agentId=${agentId}, got: ${String(payload.agentId)}`)
		if (payload.reason !== "watchdog_stale_heartbeat") {
			throw new Error(`Expected payload.reason=watchdog_stale_heartbeat, got: ${String(payload.reason)}`)
		}
		if (payload.lastHeartbeat !== lastHeartbeat) {
			throw new Error(`Expected payload.lastHeartbeat=${lastHeartbeat}, got: ${String(payload.lastHeartbeat)}`)
		}

		watchdog.stop()
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
	})

	await runTest("BaseAgent heartbeat: keeps updating during a slow iteration", async () => {
		class SlowTestAgent extends BaseAgent {
			private ran = false

			async executeIteration(): Promise<"continue" | "done" | "error"> {
				if (this.ran) return "done"
				this.ran = true
				await delay(450)
				return "done"
			}
		}

		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-heartbeat-test.db")
		const db = DatabaseService.getInstance(dbPath)
		const originalInterval = process.env["SWARM_HEARTBEAT_INTERVAL_MS"]
		process.env["SWARM_HEARTBEAT_INTERVAL_MS"] = "100"

		try {
			db.run("INSERT INTO agents (id, role, status, last_heartbeat) VALUES (?,?,?,?)", [
				"reviewer-heartbeat-test",
				"reviewer",
				"queued",
				"1970-01-01T00:00:00.000Z",
			])

			const agent = new SlowTestAgent(
				"reviewer-heartbeat-test",
				"task-heartbeat-test",
				"slow iteration",
				TEST_WORKSPACE,
				db,
				new StubModelClient("reviewer_pass"),
			)

			const runPromise = agent.runAutonomousLoop()
			await delay(30)
			const first = db.get<{ last_heartbeat: string }>("SELECT last_heartbeat FROM agents WHERE id = ?", ["reviewer-heartbeat-test"])
			await delay(220)
			const during = db.get<{ last_heartbeat: string }>("SELECT last_heartbeat FROM agents WHERE id = ?", ["reviewer-heartbeat-test"])
			await runPromise

			if (!first?.last_heartbeat || !during?.last_heartbeat) {
				throw new Error("Expected heartbeat timestamps to be present")
			}
			if (during.last_heartbeat === first.last_heartbeat) {
				throw new Error("Expected heartbeat to update while the agent was still inside the slow iteration")
			}
		} finally {
			if (originalInterval === undefined) delete process.env["SWARM_HEARTBEAT_INTERVAL_MS"]
			else process.env["SWARM_HEARTBEAT_INTERVAL_MS"] = originalInterval
			db.close()
			DatabaseService.reset()
			if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		}
	})

	await runTest("BuilderAgent wiring: sends worker_done to orchestrator", async () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-builder-test.db")
		const db = DatabaseService.getInstance(dbPath)
		const stub = new StubModelClient(["builder_simple", "builder_done"])

		const before = fs.readFileSync(path.join(TEST_WORKSPACE, "hello.ts"), "utf8")

		WorkspaceLock.setRoot(TEST_WORKSPACE)
		const agent = new BuilderAgent(
			"builder-test-1",
			"task-test-1",
			"add a comment to hello.ts",
			TEST_WORKSPACE,
			db,
			stub,
			{ dryRun: true },
		)
		await agent.runAutonomousLoop()

		const msg = db.get("SELECT * FROM messages WHERE from_agent='builder-test-1' AND type='worker_done'")
		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

		const after = fs.readFileSync(path.join(TEST_WORKSPACE, "hello.ts"), "utf8")

		if (!msg) throw new Error("BuilderAgent did not send worker_done message — wiring broken")
		if (after !== before) throw new Error("BuilderAgent modified workspace during dry-run (should not write files)")
	})

	await runTest("ReviewerAgent wiring: sends verdict to orchestrator", async () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-reviewer-test.db")
		const db = DatabaseService.getInstance(dbPath)
		const stub = new StubModelClient(["reviewer_pass"])

		const bus = new MessageBus(db)
		await bus.send({
			from: "orchestrator",
			to: "reviewer-test-1",
			type: "review_request",
			payload: {
				taskId: "task-test-1",
				taskDescription: "add a comment to hello.ts",
				filesWritten: ["hello.ts"],
				fileDiffs: { "hello.ts": "(diff stub)" },
			},
		})

		const agent = new ReviewerAgent(
			"reviewer-test-1",
			"task-test-1",
			"add a comment to hello.ts",
			TEST_WORKSPACE,
			db,
			stub,
		)
		await agent.runAutonomousLoop()

		const msg = db.get<{ payload: string }>(
			"SELECT payload FROM messages WHERE from_agent='reviewer-test-1' AND to_agent='orchestrator' AND type='verdict'",
		)

		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

		if (!msg) throw new Error("ReviewerAgent did not send verdict message — wiring broken")
		const payload = JSON.parse(msg.payload) as { verdict?: unknown }
		if (payload.verdict !== "PASS") throw new Error(`ReviewerAgent verdict expected PASS, got: ${String(payload.verdict)}`)
	})

	await runTest("ReviewerAgent invalid JSON: fails closed with NEEDS_WORK verdict", async () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-reviewer-invalid-test.db")
		const db = DatabaseService.getInstance(dbPath)
		const stub = new StubModelClient(["reviewer_invalid"])

		const bus = new MessageBus(db)
		await bus.send({
			from: "orchestrator",
			to: "reviewer-test-invalid-1",
			type: "review_request",
			payload: {
				taskId: "task-test-invalid-1",
				taskDescription: "add a comment to hello.ts",
				filesWritten: ["hello.ts"],
				fileDiffs: { "hello.ts": "(diff stub)" },
			},
		})

		const agent = new ReviewerAgent(
			"reviewer-test-invalid-1",
			"task-test-invalid-1",
			"add a comment to hello.ts",
			TEST_WORKSPACE,
			db,
			stub,
		)
		await agent.runAutonomousLoop()

		const msg = db.get<{ payload: string }>(
			"SELECT payload FROM messages WHERE from_agent='reviewer-test-invalid-1' AND to_agent='orchestrator' AND type='verdict'",
		)

		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

		if (!msg) throw new Error("ReviewerAgent did not send verdict after invalid JSON response")
		const payload = JSON.parse(msg.payload) as { verdict?: unknown; reviewOutputValid?: unknown; summary?: unknown }
		if (payload.verdict !== "NEEDS_WORK") {
			throw new Error(`ReviewerAgent should fail closed to NEEDS_WORK, got: ${String(payload.verdict)}`)
		}
		if (payload.reviewOutputValid !== false) {
			throw new Error(`Expected reviewOutputValid=false, got: ${String(payload.reviewOutputValid)}`)
		}
		if (typeof payload.summary !== "string" || !payload.summary.includes("invalid or unreadable")) {
			throw new Error(`Expected invalid/unreadable summary, got: ${String(payload.summary)}`)
		}
	})

	await runTest("Orchestrator SIMPLE path: invalid reviewer output becomes review_required", async () => {
		const { orchestrator, cleanup } = createOrchestratorHarness(true)
		try {
			const orch = orchestrator as any
			orch.runBuilderOnce = async () => ({ filesWritten: ["hello.ts"] })
			orch.collectChangeEvidence = async () => ({
				changedFiles: ["hello.ts"],
				filesForReview: ["hello.ts"],
				fileDiffs: { "hello.ts": "diff --git a/hello.ts b/hello.ts" },
				hasMeaningfulDiff: true,
			})
			orch.runReviewerOnce = async () => ({
				kind: "verdict",
				payload: {
					verdict: "NEEDS_WORK",
					summary: "Review output was invalid or unreadable; blocking automatic completion.",
					issues: [{ severity: "high", description: "Reviewer model returned invalid JSON." }],
					reviewOutputValid: false,
				},
			})

			const result = await orch.runSimpleWithRetry("", "", "task-test-1", "HEAD", "add a comment to hello.ts")
			if (result.status !== "review_required") {
				throw new Error(`Expected review_required, got: ${String(result.status)}`)
			}
		} finally {
			cleanup()
		}
	})

	await runTest("Orchestrator SIMPLE path: NEEDS_WORK after max retries blocks completion", async () => {
		const { orchestrator, cleanup } = createOrchestratorHarness(true)
		try {
			const orch = orchestrator as any
			let builderCalls = 0
			let reviewerCalls = 0

			orch.runBuilderOnce = async () => {
				builderCalls++
				return { filesWritten: ["hello.ts"] }
			}
			orch.collectChangeEvidence = async () => ({
				changedFiles: ["hello.ts"],
				filesForReview: ["hello.ts"],
				fileDiffs: { "hello.ts": "diff --git a/hello.ts b/hello.ts" },
				hasMeaningfulDiff: true,
			})
			orch.runReviewerOnce = async () => {
				reviewerCalls++
				return {
					kind: "verdict",
					payload: {
						verdict: "NEEDS_WORK",
						summary: "Still incomplete.",
						issues: [{ severity: "medium", description: "Task is only partially done." }],
						reviewOutputValid: true,
					},
				}
			}

			const result = await orch.runSimpleWithRetry("", "", "task-test-2", "HEAD", "add a comment to hello.ts")
			if (result.status !== "review_required") {
				throw new Error(`Expected review_required, got: ${String(result.status)}`)
			}
			if (builderCalls !== 3 || reviewerCalls !== 3) {
				throw new Error(`Expected 3 attempts before blocking, got builder=${builderCalls}, reviewer=${reviewerCalls}`)
			}
		} finally {
			cleanup()
		}
	})

	await runTest("Orchestrator COMPLEX path: NEEDS_WORK blocks completion", async () => {
		const { orchestrator, cleanup } = createOrchestratorHarness(true)
		try {
			const orch = orchestrator as any
			orch.runBuilderOnce = async () => ({ filesWritten: ["hello.ts"] })
			orch.collectChangeEvidence = async () => ({
				changedFiles: ["hello.ts"],
				filesForReview: ["hello.ts"],
				fileDiffs: { "hello.ts": "diff --git a/hello.ts b/hello.ts" },
				hasMeaningfulDiff: true,
			})
			orch.runReviewerOnce = async () => ({
				kind: "verdict",
				payload: {
					verdict: "NEEDS_WORK",
					summary: "Merged result still needs work.",
					issues: [{ severity: "high", description: "Combined output is incomplete." }],
					reviewOutputValid: true,
				},
			})

			const result = await orch.runComplexOnce("", "", "task-test-3", "HEAD", "add a comment to hello.ts", [
				{
					id: "subtask-1",
					description: "edit hello.ts",
					files: ["hello.ts"],
					assignedBuilder: "builder-1",
				},
			])

			if (result.status !== "review_required") {
				throw new Error(`Expected review_required, got: ${String(result.status)}`)
			}
		} finally {
			cleanup()
		}
	})

	await runTest("Orchestrator PASS without diff evidence: blocks code-changing success", async () => {
		const { orchestrator, cleanup } = createOrchestratorHarness(true)
		try {
			const orch = orchestrator as any
			orch.runBuilderOnce = async () => ({ filesWritten: ["hello.ts"] })
			orch.collectChangeEvidence = async () => ({
				changedFiles: [],
				filesForReview: ["hello.ts"],
				fileDiffs: { "hello.ts": "(no diff)" },
				hasMeaningfulDiff: false,
			})
			orch.runReviewerOnce = async () => ({
				kind: "verdict",
				payload: {
					verdict: "PASS",
					summary: "Looks fine.",
					issues: [],
					reviewOutputValid: true,
				},
			})

			const result = await orch.runSimpleWithRetry("", "", "task-test-4", "HEAD", "add a comment to hello.ts")
			if (result.status !== "review_required") {
				throw new Error(`Expected review_required, got: ${String(result.status)}`)
			}
		} finally {
			cleanup()
		}
	})

	await runTest("Orchestrator live safety: dirty repo is refused by default", async () => {
		const { repoPath, cleanup } = await createTempRepoCopy("dirty-refusal")
		DatabaseService.reset()
		const dbPath = path.join(repoPath, ".swarm", "dirty-refusal.db")
		const db = DatabaseService.getInstance(dbPath)
		try {
			fs.appendFileSync(path.join(repoPath, "hello.ts"), "\n// dirty change\n")
			const orchestrator = new Orchestrator(repoPath, db, false)
			const result = await orchestrator.run("add a comment to hello.ts")
			if (result.status !== "failed") throw new Error(`Expected failed status, got: ${result.status}`)
			if (result.stopReason !== "dirty_repo_refusal") {
				throw new Error(`Expected dirty_repo_refusal, got: ${result.stopReason}`)
			}
		} finally {
			db.close()
			DatabaseService.reset()
			cleanup()
		}
	})

	await runTest("Orchestrator live safety: --allowDirty bypasses refusal", async () => {
		const { repoPath, cleanup } = await createTempRepoCopy("allow-dirty")
		DatabaseService.reset()
		const dbPath = path.join(repoPath, ".swarm", "allow-dirty.db")
		const db = DatabaseService.getInstance(dbPath)
		try {
			fs.appendFileSync(path.join(repoPath, "hello.ts"), "\n// dirty change\n")
			const orchestrator = new Orchestrator(repoPath, db, false, { allowDirty: true })
			const orch = orchestrator as any
			orch.createInlineModelClient = () => new StubModelClient("coordinator_classify")
			orch.runSimpleWithRetry = async () => ({ status: "done", message: "ok", stopReason: "success" })

			const result = await orchestrator.run("add a comment to hello.ts")
			if (result.status !== "done") throw new Error(`Expected done status, got: ${result.status}`)
		} finally {
			db.close()
			DatabaseService.reset()
			cleanup()
		}
	})

	await runTest("Orchestrator live safety: SIMPLE live path uses isolated worktree and preserves main workspace on review_required", async () => {
		const { repoPath, cleanup } = await createTempRepoCopy("isolated-simple")
		DatabaseService.reset()
		const dbPath = path.join(repoPath, ".swarm", "isolated-simple.db")
		const db = DatabaseService.getInstance(dbPath)
		try {
			const rootHelloPath = path.join(repoPath, "hello.ts")
			const before = fs.readFileSync(rootHelloPath, "utf8")
			const orchestrator = new Orchestrator(repoPath, db, false)
			const orch = orchestrator as any
			let builderWorkspace = ""

			orch.runBuilderOnce = async (
				_runnerPath: string,
				_innerDbPath: string,
				_taskId: string,
				_builderId: string,
				_task: string,
				_envOverrides: Record<string, string>,
				workspaceOverride?: string,
			) => {
				builderWorkspace = workspaceOverride ?? ""
				if (!builderWorkspace) throw new Error("Expected builder to receive isolated workspace override")
				fs.appendFileSync(path.join(builderWorkspace, "hello.ts"), "\n// isolated mutation\n")
				return { filesWritten: ["hello.ts"] }
			}
			orch.runReviewerOnce = async () => ({
				kind: "verdict",
				payload: {
					verdict: "NEEDS_WORK",
					summary: "Still wrong.",
					issues: [],
					reviewOutputValid: true,
				},
			})

			const baseRef = await orch.getBaseRef(repoPath)
			const result = await orch.runSimpleWithRetry("", dbPath, "task-live-simple", baseRef, "add a comment to hello.ts")
			const after = fs.readFileSync(rootHelloPath, "utf8")

			if (result.status !== "review_required") throw new Error(`Expected review_required, got: ${result.status}`)
			if (!builderWorkspace || path.resolve(builderWorkspace) === path.resolve(repoPath)) {
				throw new Error(`Expected isolated builder workspace, got: ${builderWorkspace || "(empty)"}`)
			}
			if (after !== before) throw new Error("Main workspace was mutated despite review_required live run")
		} finally {
			db.close()
			DatabaseService.reset()
			cleanup()
		}
	})

	await runTest("Run artifacts: summary.json is written with status, stop reason, and model-call count", async () => {
		await resetBuiltInTestWorkspace(ROOT)
		DatabaseService.reset()
		const dbPath = path.join(TEST_WORKSPACE, ".swarm", "swarmcoder.db")
		const db = DatabaseService.getInstance(dbPath)
		try {
			const orchestrator = new Orchestrator(TEST_WORKSPACE, db, true)
			const result = await orchestrator.run("add a comment to hello.ts")
			if (!fs.existsSync(result.summaryPath)) throw new Error(`Missing summary artifact: ${result.summaryPath}`)

			const summary = JSON.parse(fs.readFileSync(result.summaryPath, "utf8")) as {
				status?: unknown
				stopReason?: unknown
				modelCallCount?: unknown
				pathChosen?: unknown
				modeSelector?: {
					modeId?: unknown
					costTier?: unknown
					selectorSource?: unknown
					reasonCodes?: unknown
				}
				fastLane?: {
					laneId?: unknown
					predictability?: unknown
					expectedWorkItems?: unknown
					expectedBuilderCount?: unknown
				}
			}

			if (summary.status !== "review_required") throw new Error(`Expected summary status review_required, got: ${String(summary.status)}`)
			if (summary.stopReason !== "no_diff_evidence") throw new Error(`Expected no_diff_evidence, got: ${String(summary.stopReason)}`)
			if (typeof summary.modelCallCount !== "number" || summary.modelCallCount < 1) {
				throw new Error(`Expected modelCallCount >= 1, got: ${String(summary.modelCallCount)}`)
			}
			if (summary.pathChosen !== "small_task") throw new Error(`Expected pathChosen small_task, got: ${String(summary.pathChosen)}`)
			if (summary.modeSelector?.modeId !== "low_cost_small_lane") {
				throw new Error(`Expected mode selector low_cost_small_lane, got: ${String(summary.modeSelector?.modeId)}`)
			}
			if (summary.modeSelector?.costTier !== "low") {
				throw new Error(`Expected mode selector costTier low, got: ${String(summary.modeSelector?.costTier)}`)
			}
			if (summary.modeSelector?.selectorSource !== "safe_single_file_template") {
				throw new Error(`Expected selectorSource safe_single_file_template, got: ${String(summary.modeSelector?.selectorSource)}`)
			}
			if (!Array.isArray(summary.modeSelector?.reasonCodes) || !summary.modeSelector.reasonCodes.includes("guardrail_budget_low")) {
				throw new Error("Expected small-task summary to include guardrail_budget_low mode selector reason code")
			}
			if (summary.fastLane?.laneId !== "simple_task_fast_lane") {
				throw new Error(`Expected fast lane simple_task_fast_lane, got: ${String(summary.fastLane?.laneId)}`)
			}
			if (summary.fastLane?.predictability !== "high") {
				throw new Error(`Expected fast lane predictability high, got: ${String(summary.fastLane?.predictability)}`)
			}
			if (summary.fastLane?.expectedWorkItems !== 1 || summary.fastLane?.expectedBuilderCount !== 1) {
				throw new Error("Expected fast lane to keep tiny work on one work item and one builder")
			}
		} finally {
			db.close()
			DatabaseService.reset()
			await resetBuiltInTestWorkspace(ROOT)
		}
	})

	await runTest("Run artifacts: explicit scoped task records scoped file list in summary", async () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", `.tmp-scoped-summary-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
		const db = DatabaseService.getInstance(dbPath)
		try {
			const orchestrator = new Orchestrator(TEST_WORKSPACE, db, true)
			const orch = orchestrator as any
			orch.runComplexOnce = async () => ({ status: "review_required", message: "blocked", stopReason: "review_blocked" })

			const result = await orchestrator.run("update hello.ts, utils.ts, and package.json together")
			const summary = JSON.parse(fs.readFileSync(result.summaryPath, "utf8")) as {
				taskContract?: { scope?: { allowedFiles?: unknown } }
			}
			const allowedFiles = Array.isArray(summary.taskContract?.scope?.allowedFiles)
				? (summary.taskContract?.scope?.allowedFiles as string[])
				: []
			const expected = ["hello.ts", "package.json", "utils.ts"]
			if (allowedFiles.sort().join(",") !== expected.join(",")) {
				throw new Error(`Expected scoped file list ${expected.join(", ")}, got: ${allowedFiles.join(", ")}`)
			}
		} finally {
			db.close()
			DatabaseService.reset()
			if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
		}
	})

	await runTest("Run artifacts: medium task records dedicated budget and capped fanout", async () => {
		const { repoPath, cleanup } = await createTempRepoCopy("medium-summary")
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", `.tmp-medium-summary-${Date.now()}-${Math.random().toString(16).slice(2)}.db`)
		const db = DatabaseService.getInstance(dbPath)
		try {
			for (const file of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"]) {
				fs.writeFileSync(path.join(repoPath, file), `export const ${file.replace(".ts", "")} = "${file}"\n`, "utf8")
			}

			const orchestrator = new Orchestrator(repoPath, db, true)
			const orch = orchestrator as any
			orch.runComplexOnce = async () => ({ status: "review_required", message: "blocked", stopReason: "review_blocked" })

			const result = await orchestrator.run("update a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, g.ts, and h.ts together")
			const summary = JSON.parse(fs.readFileSync(result.summaryPath, "utf8")) as {
				pathChosen?: unknown
				modeSelector?: {
					modeId?: unknown
					maxModelCalls?: unknown
					maxEstimatedTokens?: unknown
				}
				plan?: {
					builderCountRequested?: unknown
					builderCountRecommended?: unknown
					arbitration?: {
						activeBuilderCount?: unknown
					}
				}
			}

			if (summary.pathChosen !== "medium") throw new Error(`Expected pathChosen medium, got: ${String(summary.pathChosen)}`)
			if (summary.modeSelector?.modeId !== "high_context_medium_lane") {
				throw new Error(`Expected mode selector high_context_medium_lane, got: ${String(summary.modeSelector?.modeId)}`)
			}
			if (summary.modeSelector?.maxModelCalls !== 9) {
				throw new Error(`Expected medium maxModelCalls 9, got: ${String(summary.modeSelector?.maxModelCalls)}`)
			}
			if (summary.modeSelector?.maxEstimatedTokens !== 42_500) {
				throw new Error(`Expected medium maxEstimatedTokens 42500, got: ${String(summary.modeSelector?.maxEstimatedTokens)}`)
			}
			if (summary.plan?.builderCountRequested !== 2 || summary.plan?.builderCountRecommended !== 2) {
				throw new Error(
					`Expected medium plan builder counts 2/2, got: ${String(summary.plan?.builderCountRequested)}/${String(summary.plan?.builderCountRecommended)}`,
				)
			}
			if (summary.plan?.arbitration?.activeBuilderCount !== 2) {
				throw new Error(`Expected medium activeBuilderCount 2, got: ${String(summary.plan?.arbitration?.activeBuilderCount)}`)
			}
		} finally {
			db.close()
			DatabaseService.reset()
			if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
			cleanup()
		}
	})

	await runTest("test workspace reset: removes extra files and returns workspace to a clean baseline", async () => {
		const tempRoot = path.join(ROOT, "verification", `.tmp-reset-workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const workspace = path.join(tempRoot, "verification", "test_workspace")
		try {
			fs.mkdirSync(workspace, { recursive: true })
			for (const [relativePath, content] of Object.entries(TEST_WORKSPACE_BASELINE)) {
				const absolutePath = path.join(workspace, relativePath)
				fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
				fs.writeFileSync(absolutePath, content, "utf8")
			}

			let result = await runCommandCapture("git", ["init"], { cwd: workspace, timeoutMs: 15_000 })
			if (result.code !== 0) throw new Error(`git init failed: ${result.stderr || result.stdout}`)
			result = await runCommandCapture("git", ["config", "user.name", "SwarmCoder Test"], { cwd: workspace, timeoutMs: 15_000 })
			if (result.code !== 0) throw new Error(`git config user.name failed: ${result.stderr || result.stdout}`)
			result = await runCommandCapture("git", ["config", "user.email", "swarmcoder-test@example.com"], { cwd: workspace, timeoutMs: 15_000 })
			if (result.code !== 0) throw new Error(`git config user.email failed: ${result.stderr || result.stdout}`)
			result = await runCommandCapture("git", ["add", "-A"], { cwd: workspace, timeoutMs: 15_000 })
			if (result.code !== 0) throw new Error(`git add failed: ${result.stderr || result.stdout}`)
			result = await runCommandCapture("git", ["commit", "-m", "baseline"], { cwd: workspace, timeoutMs: 15_000 })
			if (result.code !== 0) throw new Error(`git commit failed: ${result.stderr || result.stdout}`)

			fs.writeFileSync(path.join(workspace, "hello.py"), "print('hi')\n", "utf8")
			fs.writeFileSync(path.join(workspace, "hello.ts"), "// dirty\n", "utf8")

			await resetBuiltInTestWorkspace(tempRoot)

			if (fs.existsSync(path.join(workspace, "hello.py"))) {
				throw new Error("Expected reset helper to remove extra hello.py")
			}
			const helloContents = fs.readFileSync(path.join(workspace, "hello.ts"), "utf8")
			if (helloContents !== TEST_WORKSPACE_BASELINE["hello.ts"]) {
				throw new Error("Expected hello.ts to be restored to baseline content")
			}

			result = await runCommandCapture("git", ["status", "--porcelain", "--untracked-files=all"], {
				cwd: workspace,
				timeoutMs: 15_000,
			})
			if (result.code !== 0) throw new Error(`git status failed: ${result.stderr || result.stdout}`)
			if (result.stdout.trim()) throw new Error(`Expected clean repo after reset, got: ${result.stdout.trim()}`)
		} finally {
			if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	})

	await runTest("verify:live:basic helper: runs all 3 canonical tasks through injected executor", async () => {
		let resetCount = 0
		const seen: string[] = []
		const results = await runBasicVerification(
			BASIC_VERIFICATION_TASKS,
			async () => {
				resetCount++
			},
			async (task) => {
				seen.push(task.label)
				return {
					label: task.label,
					task: task.task,
					passed: true,
					status: "done",
					stopReason: "success",
					durationMs: 1,
					summaryPath: null,
				}
			},
		)
		if (resetCount !== 3) throw new Error(`Expected reset to run 3 times, got: ${resetCount}`)
		if (seen.length !== 3) throw new Error(`Expected 3 executed tasks, got: ${seen.length}`)
		if (results.length !== 3) throw new Error(`Expected 3 results, got: ${results.length}`)
	})

	await runTest("verify:live:basic formatter: prints PASS/FAIL rows", () => {
		const output = formatVerificationResults([
			{ label: "a", task: "task a", passed: true, status: "done", stopReason: "success", durationMs: 10, summaryPath: null },
			{ label: "b", task: "task b", passed: false, status: "failed", stopReason: "dirty_repo_refusal", durationMs: 20, summaryPath: null },
		])
		if (!output.includes("PASS")) throw new Error("Expected formatted output to include PASS")
		if (!output.includes("FAIL")) throw new Error("Expected formatted output to include FAIL")
	})

	await runTest("Verification bundle formatter: prints bundle scope and failure details clearly", () => {
		const output = formatProofBundleResult({
			bundleId: "lane_small",
			label: "Small Lane",
			covers: ["single-file admission", "acceptance truth"],
			notCovered: ["medium coordination"],
			checks: [
				{ label: "Admission fixtures", passed: true, details: [] },
				{ label: "Acceptance fixtures", passed: false, details: ["missing_expected_change"] },
			],
		})
		if (!output.includes("Proof bundle: Small Lane")) {
			throw new Error(`Expected bundle label in formatter output, got: ${output}`)
		}
		if (!output.includes("Status: FAIL")) {
			throw new Error(`Expected formatter to surface FAIL when a check fails, got: ${output}`)
		}
		if (!output.includes("Does not cover: medium coordination")) {
			throw new Error(`Expected formatter to include the not-covered scope, got: ${output}`)
		}
		if (!output.includes("detail: missing_expected_change")) {
			throw new Error(`Expected formatter to surface failed-check details, got: ${output}`)
		}
	})

	await runTest("Verification bundle helper: PASS requires every check to pass", () => {
		const passing = proofBundlePassed({
			bundleId: "lane_small",
			label: "Small Lane",
			covers: ["single-file admission"],
			notCovered: ["semi-open discovery"],
			checks: [{ label: "Admission fixtures", passed: true, details: [] }],
		})
		const failing = proofBundlePassed({
			bundleId: "lane_small",
			label: "Small Lane",
			covers: ["single-file admission"],
			notCovered: ["semi-open discovery"],
			checks: [{ label: "Admission fixtures", passed: false, details: ["fixture failed"] }],
		})
		if (!passing || failing) {
			throw new Error(`Expected helper to distinguish PASS/FAIL, got passing=${passing} failing=${failing}`)
		}
	})

	await runTest("forensics:latest formatter: handles missing artifacts gracefully", () => {
		const output = formatForensicsReport(null, null)
		if (!output.includes("No run artifacts found")) {
			throw new Error(`Expected missing-artifact message, got: ${output}`)
		}
	})

	await runTest("forensics:latest formatter: surfaces verification profile status when recorded", () => {
		const output = formatForensicsReport("summary.json", {
			task: "add a brief comment to hello.ts",
			status: "review_required",
			stopReason: "verification_failed",
			verificationProfile: {
				profileName: "local-npm-test",
				status: "failed",
				message: 'Verification profile "local-npm-test" failed.',
			},
		})
		if (!output.includes("verification profile")) {
			throw new Error(`Expected verification profile bucket, got: ${output}`)
		}
		if (!output.includes("local-npm-test -> failed")) {
			throw new Error(`Expected verification status line, got: ${output}`)
		}
	})

	await runTest("forensics:latest formatter: surfaces guardrail usage and active workspace lock details", () => {
		const output = formatForensicsReport("summary.json", {
			task: "add a brief comment to hello.ts",
			status: "failed",
			stopReason: "workspace_run_locked",
			guardrails: {
				runtimeMs: { used: 120, limit: 600000, reached: false },
				modelCalls: { used: 1, limit: 6, reached: false },
				estimatedUsageTokens: { used: 420, limit: 25000, reached: false },
				workspaceRunLock: {
					blockedByActiveRun: true,
					blockingTaskId: "task-active-lock",
					blockingPid: 4321,
					acquiredAt: "2026-03-20T00:00:00.000Z",
				},
			},
		})
		if (!output.includes("Guardrails: runtime 120/600000ms")) {
			throw new Error(`Expected guardrail usage line, got: ${output}`)
		}
		if (!output.includes("Workspace lock: blocked by active live run task-active-lock")) {
			throw new Error(`Expected workspace lock line, got: ${output}`)
		}
	})

	await runTest("forensics:latest formatter: surfaces semi-open derived scope on bounded failures", () => {
		const output = formatForensicsReport("summary.json", {
			task: "sync the readme with src/config.ts",
			status: "review_required",
			stopReason: "scope_drift",
			taskContract: {
				derivation: {
					mode: "semi_open",
					taskClass: "docs_sync",
					summary: "Semi-open docs-sync scope: src/config.ts with README.md",
				},
			},
		})
		if (!output.includes("Derived scope: semi_open/docs_sync")) {
			throw new Error(`Expected semi-open derived scope line, got: ${output}`)
		}
		if (!output.includes("Likely failure bucket: semi-open scope discovery")) {
			throw new Error(`Expected semi-open scope discovery bucket, got: ${output}`)
		}
	})

	await runTest("forensics:latest classifier: maps known stop reasons to owner-friendly buckets", () => {
		if (classifyStopReason("dirty_repo_refusal").bucket !== "dirty repo refusal") {
			throw new Error("Expected dirty_repo_refusal bucket mapping")
		}
		if (classifyStopReason("review_blocked").bucket !== "review blocked") {
			throw new Error("Expected review_blocked bucket mapping")
		}
		if (classifyStopReason("ceiling_reached").bucket !== "ceiling reached") {
			throw new Error("Expected ceiling_reached bucket mapping")
		}
		if (classifyStopReason("model_call_ceiling").bucket !== "guardrail ceiling") {
			throw new Error("Expected model_call_ceiling bucket mapping")
		}
		if (classifyStopReason("workspace_run_locked").bucket !== "workspace active run lock") {
			throw new Error("Expected workspace_run_locked bucket mapping")
		}
	})

	await runTest("Thin shell command builder: launches the compiled CLI from the repo root and previews Queenshift", () => {
		const spec = buildShellLaunchSpec(ROOT, "add a brief comment to hello.ts", TEST_WORKSPACE)
		if (spec.command !== process.execPath) throw new Error(`Expected process.execPath launcher, got: ${spec.command}`)
		if (path.resolve(spec.cwd) !== path.resolve(ROOT)) throw new Error(`Expected cwd=${ROOT}, got: ${spec.cwd}`)
		if (path.resolve(spec.workspace) !== path.resolve(TEST_WORKSPACE)) {
			throw new Error(`Expected workspace=${TEST_WORKSPACE}, got: ${spec.workspace}`)
		}
		if (path.resolve(spec.cliEntry) !== path.join(ROOT, "dist", "swarm.js")) {
			throw new Error(`Expected cliEntry to point at dist/swarm.js, got: ${spec.cliEntry}`)
		}
		if (!spec.displayCommand.startsWith("queenshift ")) {
			throw new Error(`Expected displayCommand to preview the Queenshift command surface, got: ${spec.displayCommand}`)
		}
		if (!spec.displayCommand.includes('"add a brief comment to hello.ts"')) {
			throw new Error(`Expected displayCommand to include the direct task text, got: ${spec.displayCommand}`)
		}
		if (spec.displayCommand.includes("--task")) {
			throw new Error(`Expected displayCommand to prefer the direct task path, got: ${spec.displayCommand}`)
		}
		if (!spec.args.includes("add a brief comment to hello.ts")) {
			throw new Error(`Expected args to include the direct task text, got: ${spec.args.join(" ")}`)
		}
		if (spec.args.includes("--task")) {
			throw new Error(`Expected args to avoid the legacy --task prefix, got: ${spec.args.join(" ")}`)
		}
	})

	await runTest("Thin shell command builder: supports dry-run launch specs for smoke verification", () => {
		const spec = buildShellLaunchSpec(ROOT, "add a brief comment to hello.ts", TEST_WORKSPACE, { dryRun: true })
		if (!spec.args.includes("--dryRun")) throw new Error(`Expected args to include --dryRun, got: ${spec.args.join(" ")}`)
		if (!spec.displayCommand.includes("--dryRun")) {
			throw new Error(`Expected displayCommand to include --dryRun, got: ${spec.displayCommand}`)
		}
	})

	await runTest("Thin shell command builder: supports admitOnly preflight launch specs", () => {
		const spec = buildShellAdmissionSpec(ROOT, "add a brief comment to hello.ts", TEST_WORKSPACE)
		if (!spec.args.includes("--admitOnly")) {
			throw new Error(`Expected args to include --admitOnly, got: ${spec.args.join(" ")}`)
		}
		if (!spec.args.includes("add a brief comment to hello.ts")) {
			throw new Error(`Expected args to include the direct task text, got: ${spec.args.join(" ")}`)
		}
		if (spec.args.includes("--task")) {
			throw new Error(`Expected args to avoid the legacy --task prefix, got: ${spec.args.join(" ")}`)
		}
		if (!spec.displayCommand.includes("--admitOnly")) {
			throw new Error(`Expected displayCommand to include --admitOnly, got: ${spec.displayCommand}`)
		}
	})

	await runTest("Thin shell command builder: supports incident latest and rollback specs", () => {
		const latestSpec = buildShellIncidentCommandSpec(ROOT, "incident:latest", TEST_WORKSPACE)
		if (!latestSpec.args.includes("incident:latest")) {
			throw new Error(`Expected args to include incident:latest, got: ${latestSpec.args.join(" ")}`)
		}

		const rollbackSpec = buildShellIncidentCommandSpec(ROOT, "incident:rollback", TEST_WORKSPACE, "latest")
		if (!rollbackSpec.args.includes("incident:rollback") || !rollbackSpec.args.includes("latest")) {
			throw new Error(`Expected args to include incident:rollback latest, got: ${rollbackSpec.args.join(" ")}`)
		}
		if (!rollbackSpec.displayCommand.includes("incident:rollback")) {
			throw new Error(`Expected displayCommand to include incident:rollback, got: ${rollbackSpec.displayCommand}`)
		}
	})

	await runTest("Thin shell artifact reader: loads the latest summary and owner forensics", () => {
		const workspace = path.join(ROOT, "verification", `.tmp-shell-artifacts-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const runDir = path.join(workspace, ".swarm", "runs", "task-shell-latest")
		const summaryPath = path.join(runDir, "summary.json")

		try {
			fs.mkdirSync(runDir, { recursive: true })
			fs.writeFileSync(
				summaryPath,
				`${JSON.stringify(
					{
						task: "add a brief comment to hello.ts",
						status: "review_required",
						stopReason: "review_blocked",
					},
					null,
					2,
				)}\n`,
				"utf8",
			)

			const snapshot = readShellSnapshot(workspace)
			if (snapshot.summaryPath !== summaryPath) {
				throw new Error(`Expected summaryPath=${summaryPath}, got: ${snapshot.summaryPath ?? "null"}`)
			}
			if (!snapshot.summaryText.includes('"stopReason": "review_blocked"')) {
				throw new Error(`Expected summary text to include review_blocked, got: ${snapshot.summaryText}`)
			}
			if (!snapshot.forensicsText.includes("Likely failure bucket: review blocked")) {
				throw new Error(`Expected review blocked forensics, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.runtimeText.includes("Runtime summary:")) {
				throw new Error(`Expected runtime summary header, got: ${snapshot.runtimeText}`)
			}
			if (!snapshot.runtimeText.includes("Next step: queenshift review:list")) {
				throw new Error(`Expected runtime next step to point at review:list, got: ${snapshot.runtimeText}`)
			}
		} finally {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		}
	})

	await runTest("Thin shell artifact reader: handles missing previous artifacts gracefully", () => {
		const workspace = path.join(ROOT, "verification", `.tmp-shell-empty-${Date.now()}-${Math.random().toString(16).slice(2)}`)

		try {
			fs.mkdirSync(workspace, { recursive: true })
			const snapshot = readShellSnapshot(workspace)
			if (snapshot.summaryPath !== null) {
				throw new Error(`Expected null summaryPath when no artifacts exist, got: ${snapshot.summaryPath}`)
			}
			if (!snapshot.summaryText.includes("No run summary found yet")) {
				throw new Error(`Expected missing summary message, got: ${snapshot.summaryText}`)
			}
			if (!snapshot.forensicsText.includes("No run artifacts found yet")) {
				throw new Error(`Expected missing forensics message, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.runtimeText.includes("Visible progress: no run artifacts found yet for this workspace")) {
				throw new Error(`Expected missing runtime summary message, got: ${snapshot.runtimeText}`)
			}
		} finally {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		}
	})

	await runTest("Thin shell artifact reader: loads QueenBee candidate progress preview when no run summary exists", () => {
		const workspace = path.join(ROOT, "verification", `.tmp-shell-candidate-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const candidatePath = path.join(workspace, ".swarm", "queenbee-candidate", "latest-progress.json")

		try {
			fs.mkdirSync(path.dirname(candidatePath), { recursive: true })
			fs.writeFileSync(
				candidatePath,
				`${JSON.stringify(
					{
						engine: "queenbee",
						status: "candidate_not_ready",
						stopReason: "candidate_engine_not_ready",
						currentStage: "proposal",
						activeQueue: "specialist_queue",
						selectedSpecialist: "JSTSNodeBee",
						missionId: "qb-preview-mission-1",
						assignmentId: "qb-preview-bounded_node_cli_task",
						lastEventAt: "2026-03-28T10:00:00.000Z",
						nextTimeoutAt: "2026-03-28T10:05:00.000Z",
						confidenceOutcome: "candidate_preview_only",
						nextExpectedHandoff: "proposal via JSTSNodeBee, but the candidate runtime stops before live execution",
					},
					null,
					2,
				)}\n`,
				"utf8",
			)
			const snapshot = readShellSnapshot(workspace)
			if (snapshot.summaryPath !== null) {
				throw new Error(`Expected null summaryPath for candidate preview, got: ${snapshot.summaryPath}`)
			}
			if (!snapshot.summaryText.includes('"selectedSpecialist": "JSTSNodeBee"')) {
				throw new Error(`Expected summary text to include JSTSNodeBee, got: ${snapshot.summaryText}`)
			}
			if (!snapshot.summaryText.includes('"confidenceOutcome": "candidate_preview_only"')) {
				throw new Error(`Expected summary text to include candidate_preview_only, got: ${snapshot.summaryText}`)
			}
			if (!snapshot.forensicsText.includes("QueenBee candidate progress preview")) {
				throw new Error(`Expected preview forensics header, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.forensicsText.includes("Mission: qb-preview-mission-1")) {
				throw new Error(`Expected preview mission in forensics, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.forensicsText.includes("Confidence outcome: candidate_preview_only")) {
				throw new Error(`Expected preview confidence in forensics, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.runtimeText.includes("Runtime summary:")) {
				throw new Error(`Expected preview runtime summary header, got: ${snapshot.runtimeText}`)
			}
			if (!snapshot.runtimeText.includes("Visible progress: stage=proposal | queue=specialist_queue | specialist=JSTSNodeBee | confidence=candidate_preview_only")) {
				throw new Error(`Expected preview runtime summary to include stage, queue, specialist, and confidence, got: ${snapshot.runtimeText}`)
			}
			if (!snapshot.runtimeText.includes("Next step: (preview only)")) {
				throw new Error(`Expected preview runtime next step to stay preview-only, got: ${snapshot.runtimeText}`)
			}
		} finally {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		}
	})

	await runTest("Thin shell artifact reader: prefers newer QueenBee candidate preview over an older run summary", () => {
		const workspace = path.join(ROOT, "verification", `.tmp-shell-candidate-latest-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const runDir = path.join(workspace, ".swarm", "runs", "task-shell-old")
		const summaryPath = path.join(runDir, "summary.json")
		const candidatePath = path.join(workspace, ".swarm", "queenbee-candidate", "latest-progress.json")

		try {
			fs.mkdirSync(runDir, { recursive: true })
			fs.writeFileSync(
				summaryPath,
				`${JSON.stringify(
					{
						task: "old task",
						status: "review_required",
						stopReason: "review_blocked",
					},
					null,
					2,
				)}\n`,
				"utf8",
			)
			fs.mkdirSync(path.dirname(candidatePath), { recursive: true })
			fs.writeFileSync(
				candidatePath,
				`${JSON.stringify(
					{
						engine: "queenbee",
						status: "candidate_not_ready",
						stopReason: "candidate_engine_not_ready",
						currentStage: "proposal",
						activeQueue: "specialist_queue",
						selectedSpecialist: "JSTSCoreBee",
						missionId: "qb-preview-mission-2",
						assignmentId: "qb-preview-update_file_and_test",
						lastEventAt: "2026-03-28T10:10:00.000Z",
						nextTimeoutAt: "2026-03-28T10:15:00.000Z",
						confidenceOutcome: "candidate_preview_only",
						nextExpectedHandoff: "proposal via JSTSCoreBee, but the candidate runtime stops before live execution",
					},
					null,
					2,
				)}\n`,
				"utf8",
			)
			const olderSummaryTime = new Date("2026-03-28T10:00:00.000Z")
			const newerCandidateTime = new Date("2026-03-28T10:10:00.000Z")
			fs.utimesSync(summaryPath, olderSummaryTime, olderSummaryTime)
			fs.utimesSync(candidatePath, newerCandidateTime, newerCandidateTime)

			const snapshot = readShellSnapshot(workspace)
			if (snapshot.summaryPath !== null) {
				throw new Error(`Expected null summaryPath when candidate preview is newer, got: ${snapshot.summaryPath}`)
			}
			if (!snapshot.summaryText.includes('"status": "candidate_not_ready"')) {
				throw new Error(`Expected candidate preview summary text, got: ${snapshot.summaryText}`)
			}
			if (!snapshot.forensicsText.includes("Selected specialist: JSTSCoreBee")) {
				throw new Error(`Expected candidate specialist in forensics, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.forensicsText.includes("Stop reason: candidate_engine_not_ready")) {
				throw new Error(`Expected candidate stop reason in forensics, got: ${snapshot.forensicsText}`)
			}
			if (!snapshot.runtimeText.includes("Visible progress: stage=proposal | queue=specialist_queue | specialist=JSTSCoreBee | confidence=candidate_preview_only")) {
				throw new Error(`Expected newer candidate runtime summary to include JSTSCoreBee, got: ${snapshot.runtimeText}`)
			}
		} finally {
			if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true })
		}
	})

	await runTest("Guided task templates: deterministic preview and admission fixtures pass", async () => {
		const result = await runTaskTemplateHarness(ROOT)
		if (
			!result.templateGeneratesExpectedTaskContract ||
			!result.missingRequiredFieldBlocked ||
			!result.previewShowsExpectedScope ||
			!result.unsupportedTemplateOptionRefused ||
			!result.guidedTaskRoutesThroughAdmission
		) {
			throw new Error(formatTaskTemplateHarnessResult(result))
		}
	})

	await runTest("live matrix manifest: validates the frozen task list", () => {
		const issues = validateLiveMatrixTasks()
		if (issues.length > 0) throw new Error(issues.join("\n"))
		if (LIVE_MATRIX_TASKS.length < 10) throw new Error(`Expected at least 10 matrix rows, got: ${LIVE_MATRIX_TASKS.length}`)
	})

	await runTest("verify:live:matrix baseline resolver: prefers the latest dogfood baseline commit", () => {
		const logOutput = [
			"abc123\tswarm: unrelated",
			"def456\tdogfood: fix baseline files",
			"ghi789\tdogfood: baseline normalize",
		].join("\n")
		const commit = findNamedBaselineCommit(logOutput)
		if (commit !== "def456") {
			throw new Error(`Expected latest dogfood baseline commit, got: ${commit ?? "null"}`)
		}
	})

	await runTest("verify:live:matrix formatter: prints PASS/FAIL rows", () => {
		const output = formatMatrixResults([
			{
				id: "row-1",
				workspace: TEST_WORKSPACE,
				task: "task a",
				verdict: "pass",
				passed: true,
				status: "done",
				stopReason: "success",
				durationMs: 10,
				summaryPath: null,
				changedFiles: ["hello.ts"],
				repoCleanAfter: true,
				details: [],
			},
			{
				id: "row-2",
				workspace: TEST_WORKSPACE,
				task: "task b",
				verdict: "review_required",
				passed: false,
				status: "review_required",
				stopReason: "scope_drift",
				durationMs: 20,
				summaryPath: null,
				changedFiles: ["hello.ts", "package.json"],
				repoCleanAfter: true,
				details: ["scope drift"],
			},
		])
		if (!output.includes("PASS")) throw new Error("Expected matrix output to include PASS")
		if (!output.includes("FAIL")) throw new Error("Expected matrix output to include FAIL")
	})

	await runTest("verify:live:matrix evaluator: unrelated-file drift is reported as non-pass", async () => {
		const [result] = await runFixedMatrix(
			[LIVE_MATRIX_TASKS[0]!],
			async () => {
				// no-op
			},
			async () => ({
				summaryPath: null,
				summary: {
					status: "done",
					stopReason: "success",
					reviewerVerdict: "PASS",
					changedFiles: ["hello.ts", "package.json"],
					acceptanceGate: { passed: true },
				},
				durationMs: 1,
				repoCleanAfter: true,
			}),
		)
		if (!result) throw new Error("Expected one matrix result")
		if (result.passed) throw new Error("Expected unrelated-file drift to fail the row")
		if (result.verdict !== "review_required") throw new Error(`Expected review_required verdict, got: ${result.verdict}`)
	})

	await runTest("forensics:matrix:latest formatter: handles missing artifacts gracefully", () => {
		const output = formatMatrixForensicsReport(null, null)
		if (!output.includes("No matrix summary found")) {
			throw new Error(`Expected missing matrix summary message, got: ${output}`)
		}
	})

	await runTest("forensics:matrix:latest classifier: groups known matrix failure buckets", () => {
		const groups = groupMatrixFailures([
			{
				id: "scope-row",
				workspace: TEST_WORKSPACE,
				task: "scope",
				verdict: "review_required",
				passed: false,
				status: "review_required",
				stopReason: "scope_drift",
				durationMs: 1,
				summaryPath: "scope.json",
				changedFiles: ["hello.ts", "package.json"],
				repoCleanAfter: true,
				details: [],
			},
			{
				id: "provider-row",
				workspace: TEST_WORKSPACE,
				task: "provider",
				verdict: "infra_blocked",
				passed: false,
				status: "failed",
				stopReason: "provider_timeout",
				durationMs: 1,
				summaryPath: "provider.json",
				changedFiles: [],
				repoCleanAfter: true,
				details: [],
			},
		])
		const buckets = groups.map((group) => group.bucket).sort()
		if (!buckets.includes("scope drift")) throw new Error(`Expected scope drift bucket, got: ${buckets.join(", ")}`)
		if (!buckets.includes("provider or config failure")) {
			throw new Error(`Expected provider/config bucket, got: ${buckets.join(", ")}`)
		}
	})

	await runTest("beta matrix manifest: validates the fixed external repo pack", () => {
		const issues = validateBetaMatrixTasks()
		if (issues.length > 0) throw new Error(issues.join("\n"))
		const repoCount = new Set(BETA_MATRIX_TASKS.map((task) => task.workspace)).size
		if (repoCount !== 7) throw new Error(`Expected 7 beta repo copies, got: ${repoCount}`)
		if (BETA_MATRIX_TASKS.length < 12) throw new Error(`Expected at least 12 beta rows, got: ${BETA_MATRIX_TASKS.length}`)
	})

	await runTest("verify:live:beta workspace isolation: assigns a fresh workspace per row for each run", () => {
		const runDir = path.join(ROOT, ".swarm", "beta_runs", `beta-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const isolatedRows = isolateBetaRunRows(BETA_MATRIX_TASKS, runDir)
		if (isolatedRows.length !== BETA_MATRIX_TASKS.length) {
			throw new Error(`Expected ${BETA_MATRIX_TASKS.length} isolated beta rows, got ${isolatedRows.length}`)
		}

		const isolatedWorkspaces = new Set(isolatedRows.map((task) => task.workspace))
		if (isolatedWorkspaces.size !== isolatedRows.length) {
			throw new Error(`Expected every isolated beta row to have a unique workspace, got ${isolatedWorkspaces.size}/${isolatedRows.length}`)
		}

		const expectedWorkspaceRoot = path.join(runDir, "workspaces")
		for (const row of isolatedRows) {
			if (!row.workspace.startsWith(expectedWorkspaceRoot)) {
				throw new Error(`Expected isolated beta workspace under ${expectedWorkspaceRoot}, got ${row.workspace}`)
			}
		}

		if (isolatedRows.some((row, index) => row.workspace === BETA_MATRIX_TASKS[index]?.workspace)) {
			throw new Error("Expected isolated beta rows to avoid reusing the fixed manifest workspace paths")
		}
	})

	await runTest("verify:live:beta evaluator: expected scoped diffs stay green while unexpected dirt fails closed", () => {
		const repo = createFixtureRepo("beta-expected-dirty", {
			"README.md": "The config summary helper reads the checked-in defaults.\n",
			"src/config.ts": "// beta: config summary\nexport const configSummary = true\n",
		})

		try {
			const templateRow = BETA_MATRIX_TASKS.find((task) => task.id === "config-readme-sync")
			if (!templateRow) throw new Error("Expected config-readme-sync beta row fixture")
			const row = { ...templateRow, workspace: repo.repoPath }

			const cleanScopedResult = evaluateBetaRow(row, {
				admission: {
					repo: {
						supportTier: row.expectedSupportTier,
						supportTierLabel: "Small supported repo",
					},
				},
				admissionDecision: "allow_with_review_bias",
				admissionReasonCodes: ["scoped_multi_file_task"],
				summaryPath: "summary.json",
				summary: {
					status: "done",
					stopReason: "success",
					reviewerVerdict: "PASS",
					changedFiles: ["README.md", "src/config.ts"],
					acceptanceGate: { passed: true },
					verificationProfile: { profileName: "local-node-verify-script", status: "passed" },
				},
				durationMs: 1,
				repoStatusEntries: [" M README.md", " M src/config.ts"],
				artifactDir: "artifacts",
				details: [],
			})

			if (cleanScopedResult.verdict !== "pass" || !cleanScopedResult.passed) {
				throw new Error(`Expected scoped beta row to pass, got ${cleanScopedResult.verdict}`)
			}
			if (cleanScopedResult.details.some((detail) => detail.includes("workspace was dirty after the row completed"))) {
				throw new Error("Expected intended scoped diff to avoid dirty-after-row detail")
			}

			const unexpectedDirtyResult = evaluateBetaRow(row, {
				admission: {
					repo: {
						supportTier: row.expectedSupportTier,
						supportTierLabel: "Small supported repo",
					},
				},
				admissionDecision: "allow_with_review_bias",
				admissionReasonCodes: ["scoped_multi_file_task"],
				summaryPath: "summary.json",
				summary: {
					status: "done",
					stopReason: "success",
					reviewerVerdict: "PASS",
					changedFiles: ["README.md", "src/config.ts"],
					acceptanceGate: { passed: true },
					verificationProfile: { profileName: "local-node-verify-script", status: "passed" },
				},
				durationMs: 1,
				repoStatusEntries: [" M README.md", " M src/config.ts", "?? scratch.txt"],
				artifactDir: "artifacts",
				details: [],
			})

			if (unexpectedDirtyResult.verdict !== "review_required") {
				throw new Error(`Expected unexpected beta dirt to require review, got ${unexpectedDirtyResult.verdict}`)
			}
			if (!unexpectedDirtyResult.details.some((detail) => detail.includes("repo status after row:"))) {
				throw new Error("Expected unexpected beta dirt to surface repo-status evidence")
			}
		} finally {
			repo.cleanup()
		}
	})

	await runTest("verify:live:beta aggregation: counts pass, review, failed, and refused rows honestly", () => {
		const summary = summarizeBetaRun(
			[
				{
					id: "pass-row",
					corpusTaskId: "comment_file",
					repoId: "repo-a",
					repoLabel: "Repo A",
					workspace: TEST_WORKSPACE,
					task: "task pass",
					verdict: "pass",
					passed: true,
					status: "done",
					stopReason: "success",
					durationMs: 10,
					admissionDecision: "allow",
					admissionReasonCodes: [],
					summaryPath: "pass-summary.json",
					artifactDir: "pass-artifacts",
					changedFiles: ["hello.ts"],
					repoCleanAfter: true,
					expectedVerificationProfile: null,
					observedVerificationProfile: null,
					expectedSupportTier: "small_supported",
					observedSupportTier: "small_supported",
					observedSupportTierLabel: "Small supported repo",
					details: [],
				},
				{
					id: "review-row",
					corpusTaskId: "bounded_two_file_update",
					repoId: "repo-b",
					repoLabel: "Repo B",
					workspace: TEST_WORKSPACE,
					task: "task review",
					verdict: "review_required",
					passed: false,
					status: "review_required",
					stopReason: "review_blocked",
					durationMs: 20,
					admissionDecision: "allow_with_review_bias",
					admissionReasonCodes: ["scoped_multi_file_task"],
					summaryPath: "review-summary.json",
					artifactDir: "review-artifacts",
					changedFiles: ["hello.ts", "utils.ts"],
					repoCleanAfter: true,
					expectedVerificationProfile: "local-npm-test",
					observedVerificationProfile: "local-npm-test",
					expectedSupportTier: "small_supported",
					observedSupportTier: "small_supported",
					observedSupportTierLabel: "Small supported repo",
					details: ["reviewer verdict was NEEDS_WORK"],
				},
				{
					id: "failed-row",
					corpusTaskId: "sync_docs_with_source",
					repoId: "repo-c",
					repoLabel: "Repo C",
					workspace: TEST_WORKSPACE,
					task: "task fail",
					verdict: "failed",
					passed: false,
					status: "failed",
					stopReason: "provider_timeout",
					durationMs: 30,
					admissionDecision: "allow",
					admissionReasonCodes: [],
					summaryPath: "failed-summary.json",
					artifactDir: "failed-artifacts",
					changedFiles: [],
					repoCleanAfter: true,
					expectedVerificationProfile: null,
					observedVerificationProfile: null,
					expectedSupportTier: "large_supported_tier_2",
					observedSupportTier: "large_supported_tier_2",
					observedSupportTierLabel: "Large repo tier 2 candidate",
					details: ["live run ended without a summary artifact"],
				},
				{
					id: "refused-row",
					corpusTaskId: "medium_multi_file_update",
					repoId: "repo-d",
					repoLabel: "Repo D",
					workspace: TEST_WORKSPACE,
					task: "task refuse",
					verdict: "refused",
					passed: false,
					status: "admission_refused",
					stopReason: "admission_refused",
					durationMs: 5,
					admissionDecision: "refuse",
					admissionReasonCodes: ["too_many_target_files"],
					summaryPath: null,
					artifactDir: "refused-artifacts",
					changedFiles: [],
					repoCleanAfter: true,
					expectedVerificationProfile: null,
					observedVerificationProfile: null,
					expectedSupportTier: "large_supported_tier_2",
					observedSupportTier: "large_supported_tier_2",
					observedSupportTierLabel: "Large repo tier 2 candidate",
					details: [],
				},
			],
			"2026-03-20T00:00:00.000Z",
		)
		if (summary.totalRows !== 4) throw new Error(`Expected 4 rows, got: ${summary.totalRows}`)
		if (summary.passCount !== 1) throw new Error(`Expected passCount=1, got: ${summary.passCount}`)
		if (summary.reviewRequiredCount !== 1) throw new Error(`Expected reviewRequiredCount=1, got: ${summary.reviewRequiredCount}`)
		if (summary.failedCount !== 1) throw new Error(`Expected failedCount=1, got: ${summary.failedCount}`)
		if (summary.refusedCount !== 1) throw new Error(`Expected refusedCount=1, got: ${summary.refusedCount}`)
		if (summary.passRate !== 25) throw new Error(`Expected passRate=25, got: ${summary.passRate}`)

		const output = formatBetaResults(summary)
		if (!output.includes("Pass count: 1")) throw new Error(`Expected beta output to include pass count, got: ${output}`)
		if (!output.includes("Refused count: 1")) throw new Error(`Expected beta output to include refused count, got: ${output}`)
		if (!output.includes("Support tier success:")) {
			throw new Error(`Expected beta output to include support tier success, got: ${output}`)
		}
	})

	await runTest("forensics:beta:latest formatter: handles missing artifacts gracefully", () => {
		const output = formatBetaForensicsReport(null, null)
		if (!output.includes("No beta summary found")) {
			throw new Error(`Expected missing beta summary message, got: ${output}`)
		}
	})

	await runTest("forensics:beta:latest classifier: groups known beta failure buckets", () => {
		const groups = groupBetaFailures([
			{
				id: "scope-row",
				corpusTaskId: "bounded_two_file_update",
				repoId: "repo-scope",
				repoLabel: "Repo Scope",
				workspace: TEST_WORKSPACE,
				task: "scope",
				verdict: "review_required",
				passed: false,
				status: "review_required",
				stopReason: "scope_drift",
				durationMs: 1,
				admissionDecision: "allow_with_review_bias",
				admissionReasonCodes: [],
				summaryPath: "scope.json",
				artifactDir: "scope-artifacts",
				changedFiles: ["hello.ts", "package.json"],
				repoCleanAfter: true,
				expectedVerificationProfile: null,
				observedVerificationProfile: null,
				expectedSupportTier: "small_supported",
				observedSupportTier: "small_supported",
				observedSupportTierLabel: "Small supported repo",
				details: ["scope drift detected: package.json"],
			},
			{
				id: "refuse-row",
				corpusTaskId: "medium_multi_file_update",
				repoId: "repo-refuse",
				repoLabel: "Repo Refuse",
				workspace: TEST_WORKSPACE,
				task: "refuse",
				verdict: "refused",
				passed: false,
				status: "admission_refused",
				stopReason: "admission_refused",
				durationMs: 1,
				admissionDecision: "refuse",
				admissionReasonCodes: ["too_many_target_files"],
				summaryPath: null,
				artifactDir: "refuse-artifacts",
				changedFiles: [],
				repoCleanAfter: true,
				expectedVerificationProfile: null,
				observedVerificationProfile: null,
				expectedSupportTier: "large_supported_tier_2",
				observedSupportTier: "large_supported_tier_2",
				observedSupportTierLabel: "Large repo tier 2 candidate",
				details: [],
			},
			{
				id: "verify-row",
				corpusTaskId: "update_file_and_test",
				repoId: "repo-verify",
				repoLabel: "Repo Verify",
				workspace: TEST_WORKSPACE,
				task: "verify",
				verdict: "failed",
				passed: false,
				status: "review_required",
				stopReason: "verification_failed",
				durationMs: 1,
				admissionDecision: "allow",
				admissionReasonCodes: [],
				summaryPath: "verify.json",
				artifactDir: "verify-artifacts",
				changedFiles: ["hello.ts"],
				repoCleanAfter: true,
				expectedVerificationProfile: "local-npm-test",
				observedVerificationProfile: "local-npm-test",
				expectedSupportTier: "small_supported",
				observedSupportTier: "small_supported",
				observedSupportTierLabel: "Small supported repo",
				details: ["verification profile did not pass (status=failed)"],
			},
			{
				id: "dirty-row",
				corpusTaskId: "comment_file",
				repoId: "repo-dirty",
				repoLabel: "Repo Dirty",
				workspace: TEST_WORKSPACE,
				task: "dirty",
				verdict: "review_required",
				passed: false,
				status: "done",
				stopReason: "success",
				durationMs: 1,
				admissionDecision: "allow",
				admissionReasonCodes: [],
				summaryPath: "dirty.json",
				artifactDir: "dirty-artifacts",
				changedFiles: ["hello.ts"],
				repoCleanAfter: false,
				expectedVerificationProfile: null,
				observedVerificationProfile: null,
				expectedSupportTier: "small_supported",
				observedSupportTier: "small_supported",
				observedSupportTierLabel: "Small supported repo",
				details: [
					"workspace was dirty after the row completed",
					"repo status after row: git status failed: index lock still held",
				],
			},
		])
		const buckets = groups.map((group) => group.bucket).sort()
		if (!buckets.includes("dirty after row")) throw new Error(`Expected dirty-after-row bucket, got: ${buckets.join(", ")}`)
		if (!buckets.includes("scope drift")) throw new Error(`Expected scope drift bucket, got: ${buckets.join(", ")}`)
		if (!buckets.includes("admission refusal")) throw new Error(`Expected admission refusal bucket, got: ${buckets.join(", ")}`)
		if (!buckets.includes("verification profile")) {
			throw new Error(`Expected verification profile bucket, got: ${buckets.join(", ")}`)
		}
	})

	await runTest("verify:acceptance:gates fixtures: all expectations hold", () => {
		const results = runAcceptanceFixtures()
		const output = formatAcceptanceFixtureResults(results)
		if (!output.includes("PASS")) throw new Error("Expected acceptance fixture output to include PASS")
		if (results.some((result) => !result.passed)) {
			throw new Error("Expected all acceptance fixtures to match their expected outcomes")
		}
	})

	await runTest("verify:provider:resilience fixtures: all expectations hold", async () => {
		const results = await runProviderResilienceFixtures()
		const output = formatProviderResilienceResults(results)
		if (!output.includes("PASS")) throw new Error("Expected provider resilience output to include PASS")
		if (results.some((result) => !result.passed)) {
			throw new Error("Expected all provider resilience fixtures to pass")
		}
	})

	await runTest("verify:recovery harness: cleans leftovers and allows a rerun", async () => {
		const result = await runRecoveryHarness()
		const output = formatRecoveryHarnessResult(result)
		if (!output.includes("Crash simulation")) throw new Error("Expected recovery output to mention crash simulation")
		if (
			!result.leftoverInventoryRecovered ||
			!result.crashSimulation ||
			!result.abortArtifactRecovered ||
			!result.recoveryHintVisible ||
			!result.failureNarrativeVisible ||
			!result.rerunAfterCleanup ||
			!result.idempotentCleanup
		) {
			throw new Error("Expected recovery harness to pass all checks")
		}
	})

	await runTest("verify:admission harness: repo readiness and task admission fixtures pass", async () => {
		const result = await runAdmissionHarness()
		const output = formatAdmissionHarnessResult(result)
		if (!output.includes("Clean safe repo admitted")) {
			throw new Error("Expected admission harness output to mention the clean safe repo case")
		}
		if (
			!result.cleanSafeRepoAdmitted ||
			!result.dirtyRepoRefused ||
			!result.unsupportedTaskRefused ||
			!result.scopedSafeTaskAdmitted ||
			!result.missingVerificationProfileSurfaced ||
			!result.largeRepoTierSurfaced
		) {
			throw new Error("Expected admission harness to pass all checks")
		}
	})

	await runTest("verify:profiles harness: repo-declared verification profiles pass deterministic fixtures", async () => {
		const result = await runProfilesHarness()
		const output = formatProfilesHarnessResult(result)
		if (!output.includes("Manifest drift is blocked")) {
			throw new Error(`Expected profile harness output to mention manifest drift protection, got: ${output}`)
		}
		if (
			!result.matchingProfilePasses ||
			!result.manifestBackedScriptPasses ||
			!result.typescriptProfilePasses ||
			!result.pythonProfilePasses ||
			!result.vitestProfilePasses ||
			!result.eslintProfilePasses ||
			!result.pythonUnittestPasses ||
			!result.goProfilePasses ||
			!result.cargoProfilePasses ||
			!result.matchingProfileFails ||
			!result.noApplicableProfileReported ||
			!result.blockedCommandRefused ||
			!result.manifestDriftBlocked ||
			!result.policyPackBlocksNpmTest ||
			!result.timeoutSurfaced ||
			!result.adapterContractsExplicit ||
			!result.adapterCatalogDocsAligned ||
			!result.languageMatrixDocsAligned ||
			!result.frameworkConfidenceDocsAligned ||
			!result.contributorProofLoopDocsAligned ||
			!result.modeSelectorVisible
		) {
			throw new Error("Expected verification profile harness to pass all checks")
		}
	})

	await runTest("verify:guardrails harness: ceilings and single-run lock fixtures pass", async () => {
		const result = await runGuardrailsHarness()
		const output = formatGuardrailsHarnessResult(result)
		if (!output.includes("Model-call ceiling stops run")) {
			throw new Error(`Expected guardrails harness output to mention model-call ceilings, got: ${output}`)
		}
		if (
			!result.modelCallCeilingStopsRun ||
			!result.runtimeCeilingStopsRun ||
			!result.usageBudgetCeilingStopsRun ||
			!result.ceilingArtifactsReported ||
			!result.fastLaneVisible ||
			!result.workspaceSingleRunLock ||
			!result.secondLiveRunRefusedGracefully ||
			!result.backgroundQueueApprovalBoundary ||
			!result.scheduledQueueBoundary ||
			!result.adapterContractsBounded
		) {
			throw new Error("Expected guardrails harness to pass all checks")
		}
	})

	await runTest("verify:review:queue harness: review inbox approve/discard flow passes", async () => {
		const result = await runReviewQueueHarness()
		const output = formatReviewQueueHarnessResult(result)
		if (!output.includes("Approve eligible review")) throw new Error("Expected review queue output to mention approval")
		if (
			!result.listingWorks ||
			!result.showWorks ||
			!result.mergeNegotiationVisible ||
			!result.approvalPackageVisible ||
			!result.queueFollowUpVisible ||
			!result.approveWorks ||
			!result.blockedMergeNegotiationRefusesApproval ||
			!result.discardWorks ||
			!result.multiReviewerPolicyWorks ||
			!result.operatorAuditVisible
		) {
			throw new Error("Expected review queue harness to pass all checks")
		}
	})

	await runTest("verify:owner:provider-defaults harness: owner provider resolution fails closed and stays visible", async () => {
		const result = await runOwnerProviderDefaultsHarness()
		const output = formatOwnerProviderDefaultsHarnessResult(result)
		if (!output.includes("Gemini OAuth preferred")) {
			throw new Error(`Expected owner provider defaults output to mention Gemini OAuth, got: ${output}`)
		}
		if (
			!result.geminiOauthPreferred ||
			!result.geminiCliFallbackVisible ||
			!result.geminiCliCommandPinned ||
			!result.unconfiguredFailsClosed ||
			!result.retryPolicySurfaced ||
			!result.statusTextMakesProviderVisible ||
			!result.diagnosticGuidanceVisible
		) {
			throw new Error("Expected owner provider defaults harness to pass all checks")
		}
	})

	await runTest("verify:owner:cache harness: remembered defaults stay explicit, drift-safe, and resettable", async () => {
		const result = await runOwnerCacheHarness()
		const output = formatOwnerCacheHarnessResult(result)
		if (!output.includes("Cache remembers safe defaults")) {
			throw new Error(`Expected owner cache output to mention remembered defaults, got: ${output}`)
		}
		if (
			!result.cacheRemembersSafeDefaults ||
			!result.cacheDriftFailsClosed ||
			!result.resetClearsCache ||
			!result.layerBoundaryVisible ||
			!result.statusTextVisible
		) {
			throw new Error("Expected owner cache harness to pass all checks")
		}
	})

	await runTest("verify:owner:task-library harness: starter tasks stay transparent and bounded", async () => {
		const result = await runOwnerTaskLibraryHarness()
		const output = formatOwnerTaskLibraryHarnessResult(result)
		if (!output.includes("Starter library visible")) {
			throw new Error(`Expected owner task library output to mention starter library visibility, got: ${output}`)
		}
		if (!result.starterLibraryVisible || !result.starterDraftIsTransparent || !result.parameterSlotsWork || !result.starterStillRoutesThroughAdmission) {
			throw new Error("Expected owner task library harness to pass all checks")
		}
	})

	await runTest("verify:task-corpus harness: owner and beta evidence collapse into one honest task matrix", async () => {
		const result = await runTaskCorpusHarness()
		const output = formatTaskCorpusHarnessResult(result)
		if (!output.includes("Owner and beta evidence grouped")) {
			throw new Error(`Expected task corpus output to mention grouped evidence, got: ${output}`)
		}
		if (
			!result.catalogValidationPasses ||
			!result.ownerAndBetaEvidenceGrouped ||
			!result.strangerBaselineVisible ||
			!result.benchmarkAndDemoLinksVisible ||
			!result.structuredCoverageVisible ||
			!result.steeringAndCostBaselineVisible ||
			!result.scoutPlaybookVisible ||
			!result.reliabilitySignalsVisible ||
			!result.replayLearningVisible ||
			!result.nextFocusVisible
		) {
			throw new Error("Expected task corpus harness to pass all checks")
		}
	})

	await runTest("verify:owner:quick-actions harness: follow-up routing stays compact and artifact-backed", async () => {
		const result = await runOwnerQuickActionsHarness()
		const output = formatOwnerQuickActionsHarnessResult(result)
		if (!output.includes("Review actions visible")) {
			throw new Error(`Expected owner quick actions output to mention review actions, got: ${output}`)
		}
		if (
			!result.reviewActionsVisible ||
			!result.incidentActionsVisible ||
			!result.rerunActionVisible ||
			!result.redLaneSuggestionVisible ||
			!result.triageVisible ||
			!result.triageDetailsVisible
		) {
			throw new Error("Expected owner quick actions harness to pass all checks")
		}
	})

	await runTest("verify:incident-triage harness: advisory incident taxonomy maps evidence to next actions", async () => {
		const result = await runIncidentTriageHarness()
		const output = formatIncidentTriageHarnessResult(result)
		if (!output.includes("Owner quick actions show triage")) {
			throw new Error(`Expected incident-triage output to mention owner quick actions, got: ${output}`)
		}
		if (
			!result.providerIssueClassified ||
			!result.scopeIssueClassified ||
			!result.reviewIssueClassified ||
			!result.detailedTaxonomyVisible ||
			!result.ownerQuickActionsShowTriage ||
			!result.ownerQuickActionsShowFixRedLane
		) {
			throw new Error(`Expected incident-triage harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:owner:life-signal harness: owner status shows one compact live answer", async () => {
		const result = await runOwnerLifeSignalHarness()
		const output = formatOwnerLifeSignalHarnessResult(result)
		if (!output.includes("Running state visible")) {
			throw new Error(`Expected owner life-signal output to mention running state, got: ${output}`)
		}
		if (
			!result.runningStateVisible ||
			!result.activeAgentVisible ||
			!result.blockedBucketVisible ||
			!result.idleGuidanceVisible ||
			!result.nextCommandVisible ||
			!result.queueVisible ||
			!result.queueReasonVisible ||
			!result.outcomeDashboardVisible ||
			!result.outcomeBucketsVisible ||
			!result.statusSurfaceVisible ||
			!result.lowSteeringLoopVisible
		) {
			throw new Error("Expected owner life-signal harness to pass all checks")
		}
	})

	await runTest("verify:task-composer harness: structured composer fields stay transparent before launch", async () => {
		const result = await runTaskComposerHarness()
		const output = formatTaskComposerHarnessResult(result)
		if (!output.includes("Lane preview visible")) {
			throw new Error(`Expected task-composer output to mention lane preview visibility, got: ${output}`)
		}
		if (
			!result.structuredFieldsComposeTask ||
			!result.finalPromptPreviewVisible ||
			!result.lanePreviewVisible ||
			!result.calmDefaultVisible ||
			!result.presetEvidenceVisible ||
			!result.notesRemainTransparent
		) {
			throw new Error(`Expected task-composer harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:plan-schema harness: complex runs record a bounded plan artifact", async () => {
		const result = await runPlanSchemaHarness()
		const output = formatPlanSchemaHarnessResult(result)
		if (!output.includes("Stable subtask ids")) {
			throw new Error(`Expected plan schema output to mention stable subtask ids, got: ${output}`)
		}
		if (
			!result.stableSubtaskIds ||
			!result.dependencyFieldsPresent ||
			!result.builderCountAwareHints ||
			!result.planningHorizonVisible ||
			!result.roleContextPolicyVisible ||
			!result.corpusScoutVisible ||
			!result.planExecutionSeparated ||
			!result.refusalFailsClosed
		) {
			throw new Error("Expected plan schema harness to pass all checks")
		}
	})

	await runTest("verify:assignment-ledger harness: planned work turns into explicit ownership slots", async () => {
		const result = await runAssignmentLedgerHarness()
		const output = formatAssignmentLedgerHarnessResult(result)
		if (!output.includes("Explicit ledger visible")) {
			throw new Error(`Expected assignment ledger output to mention explicit ledger visibility, got: ${output}`)
		}
		if (
			!result.explicitLedgerVisible ||
			!result.handoffValidationWorks ||
			!result.assignmentTokensPresent ||
			!result.dynamicArbitrationVisible ||
			!result.delegationRulesVisible ||
			!result.dependencyMetadataVisible
		) {
			throw new Error("Expected assignment ledger harness to pass all checks")
		}
	})

	await runTest("verify:progress-map harness: assignment state changes stay compact and truthful", async () => {
		const result = await runProgressMapHarness()
		const output = formatProgressMapHarnessResult(result)
		if (!output.includes("In-progress state visible")) {
			throw new Error(`Expected progress map output to mention in-progress state, got: ${output}`)
		}
		if (
			!result.inProgressStateVisible ||
			!result.dependencyWaitVisible ||
			!result.dependencyReleaseVisible ||
			!result.completeStateVisible ||
			!result.stageWindowVisible ||
			!result.progressArtifactVisible
		) {
			throw new Error("Expected progress map harness to pass all checks")
		}
	})

	await runTest("verify:replay-export harness: timeline export stays artifact-backed and easy to inspect", async () => {
		const result = await runReplayExportHarness()
		const output = formatReplayExportHarnessResult(result)
		if (!output.includes("Replay artifact persisted")) {
			throw new Error(`Expected replay-export output to mention replay persistence, got: ${output}`)
		}
		if (
			!result.replayArtifactPersisted ||
			!result.stageSequenceVisible ||
			!result.manifestMetadataVisible ||
			!result.overviewVisible ||
			!result.learningLoopVisible ||
			!result.reproducibilityVisible ||
			!result.divergenceComparisonVisible ||
			!result.replayLocationVisible
		) {
			throw new Error("Expected replay-export harness to pass all checks")
		}
	})

	await runTest("verify:completion-ledger harness: done requires assignment tokens plus proof", async () => {
		const result = await runCompletionLedgerHarness()
		const output = formatCompletionLedgerHarnessResult(result)
		if (!output.includes("Blocked entries recorded")) {
			throw new Error(`Expected completion ledger output to mention blocked entries, got: ${output}`)
		}
		if (
			!result.blockedEntriesRecorded ||
			!result.dependencyStateVisible ||
			!result.stageWindowVisible ||
			!result.proofArtifactRequiredForComplete ||
			!result.dependencyOrderingRejected ||
			!result.staleCompletionRejected
		) {
			throw new Error("Expected completion ledger harness to pass all checks")
		}
	})

	await runTest("verify:ask-sibling harness: bounded worker clarification stays inspectable", async () => {
		const result = await runAskSiblingHarness()
		const output = formatAskSiblingHarnessResult(result)
		if (!output.includes("Artifacted exchange format")) {
			throw new Error(`Expected ask-sibling output to mention artifacted exchange format, got: ${output}`)
		}
		if (
			!result.artifactedExchangeFormat ||
			!result.routePolicyVisible ||
			!result.delegationPolicyVisible ||
			!result.limitEnforcementWorks ||
			!result.onlyAssignedWorkersMayAsk ||
			!result.unrelatedRouteBlocked ||
			!result.sameStageRouteBlockedByPolicy ||
			!result.summarySurfaceIncludesLane
		) {
			throw new Error("Expected ask-sibling harness to pass all checks")
		}
	})

	await runTest("verify:critic-lane harness: bounded critic output stays structured and separate from execution truth", async () => {
		const result = await runCriticLaneHarness()
		const output = formatCriticLaneHarnessResult(result)
		if (!output.includes("Concern visible on complex run")) {
			throw new Error(`Expected critic-lane output to mention complex-run concerns, got: ${output}`)
		}
		if (
			!result.entryConditionsBounded ||
			!result.structuredOutputVisible ||
			!result.concernVisibleOnComplexRun ||
			!result.arbitrationConcernVisible ||
			!result.teamShapeSpecializationVisible ||
			!result.refactorConcernVisible ||
			!result.targetedEvaluatorVisible ||
			!result.renameEvaluatorVisible ||
			!result.executionTruthSeparated
		) {
			throw new Error("Expected critic-lane harness to pass all checks")
		}
	})

	await runTest("verify:retry-planner harness: retries stay bounded, explicit, and red-lane aware", async () => {
		const result = await runRetryPlannerHarness()
		const output = formatRetryPlannerHarnessResult(result)
		if (!output.includes("Retryable decision visible")) {
			throw new Error(`Expected retry-planner output to mention retryable decisions, got: ${output}`)
		}
		if (
			!result.retryableDecisionVisible ||
			!result.redLaneRefusalWorks ||
			!result.partialRecoveryModeVisible ||
			!result.stageAwareProposalVisible ||
			!result.continuationHistoryVisible ||
			!result.proposalsHumanReadable ||
			!result.summarySurfaceVisible
		) {
			throw new Error("Expected retry-planner harness to pass all checks")
		}
	})

	await runTest("verify:retry-snapshots harness: exact retry snapshots persist and fail closed when missing", async () => {
		const result = await runRetrySnapshotHarness()
		const output = formatRetrySnapshotHarnessResult(result)
		if (!output.includes("Snapshot persisted")) {
			throw new Error(`Expected retry-snapshots output to mention snapshot persistence, got: ${output}`)
		}
		if (
			!result.snapshotPersisted ||
			!result.assignmentStatePreserved ||
			!result.partialRecoveryStatePreserved ||
			!result.manifestHashPreserved ||
			!result.missingSnapshotFailsClosed
		) {
			throw new Error("Expected retry-snapshots harness to pass all checks")
		}
	})

	await runTest("verify:checkpoints harness: partial completion stays truthful and resumable", async () => {
		const result = await runCheckpointHarness()
		const output = formatCheckpointHarnessResult(result)
		if (!output.includes("Checkpoint artifact persisted")) {
			throw new Error(`Expected checkpoints output to mention artifact persistence, got: ${output}`)
		}
		if (
			!result.checkpointArtifactPersisted ||
			!result.partialProgressVisible ||
			!result.retrySnapshotLinked ||
			!result.continuationHistoryVisible ||
			!result.manifestHashPreserved
		) {
			throw new Error("Expected checkpoints harness to pass all checks")
		}
	})

	await runTest("verify:resume harness: latest valid checkpoint reconstructs bounded remaining work", async () => {
		const result = await runResumeHarness()
		const output = formatResumeHarnessResult(result)
		if (!output.includes("Resume success visible")) {
			throw new Error(`Expected resume output to mention resume success visibility, got: ${output}`)
		}
		if (
			!result.resumeSuccessVisible ||
			!result.remainingWorkReconstructed ||
			!result.recoveryModeVisible ||
			!result.continuationHistoryVisible ||
			!result.manifestValidationFailsClosed ||
			!result.missingCompletedBranchFailsClosed
		) {
			throw new Error("Expected resume harness to pass all checks")
		}
	})

	await runTest("verify:repo-map harness: compact repo map stays deterministic and planner-visible", async () => {
		const result = await runRepoMapHarness()
		const output = formatRepoMapHarnessResult(result)
		if (!output.includes("Planning artifact visible")) {
			throw new Error(`Expected repo-map output to mention planning artifact visibility, got: ${output}`)
		}
		if (
			!result.structureVisible ||
			!result.entryPointsVisible ||
			!result.styleHintsVisible ||
			!result.gitHintsVisible ||
			!result.languagePacksVisible ||
			!result.frameworkHintsVisible ||
			!result.scoutPackVisible ||
			!result.discoveryPackVisible ||
			!result.supportTierVisible ||
			!result.largeTierPolicyVisible ||
			!result.cacheStateVisible ||
			!result.memoryBoundaryVisible ||
			!result.planningArtifactVisible
		) {
			throw new Error(`Expected repo-map harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:role-manuals harness: versioned role discipline stays visible in prompts and artifacts", async () => {
		const result = await runRoleManualHarness()
		const output = formatRoleManualHarnessResult(result)
		if (!output.includes("Plan artifact carries versions")) {
			throw new Error(`Expected role-manual output to mention artifact versions, got: ${output}`)
		}
		if (
			!result.catalogVisible ||
			!result.specializationCatalogVisible ||
			!result.promptInjectionVisible ||
			!result.specializationPromptVisible ||
			!result.roleContextDifferentiated ||
			!result.planArtifactCarriesVersions ||
			!result.planTeamShapeVisible ||
			!result.criticManualVersionVisible
		) {
			throw new Error("Expected role-manual harness to pass all checks")
		}
	})

	await runTest("verify:context-packs harness: bounded context stays artifact-backed and prompt-injected", async () => {
		const result = await runContextPackHarness()
		const output = formatContextPackHarnessResult(result)
		if (!output.includes("Builder prompt injection visible")) {
			throw new Error(`Expected context-pack output to mention builder prompt injection, got: ${output}`)
		}
		if (
			!result.selectedTargetsVisible ||
			!result.budgetAndOmissionsVisible ||
			!result.knowledgeDocsVisible ||
			!result.knowledgePackPriorityVisible ||
			!result.discoveryPackVisible ||
			!result.largeTierPolicyVisible ||
			!result.scoutHintsVisible ||
			!result.roleViewsVisible ||
			!result.plannerPromptInjectionVisible ||
			!result.builderPromptInjectionVisible ||
			!result.runArtifactVisible ||
			!result.subtaskSlicesVisible
		) {
			throw new Error(`Expected context-pack harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:pattern-memory harness: accepted-run advice stays resettable and subordinate to current evidence", async () => {
		const result = await runPatternMemoryHarness()
		const output = formatPatternMemoryHarnessResult(result)
		if (!output.includes("Planner suggestions injected")) {
			throw new Error(`Expected pattern-memory output to mention planner suggestions, got: ${output}`)
		}
		if (
			!result.acceptedRunsTracked ||
			!result.compactionVisible ||
			!result.advisoryMatchesVisible ||
			!result.replayLearnedVisible ||
			!result.conventionMemoryVisible ||
			!result.layeredMemoryOverviewVisible ||
			!result.plannerSuggestionsInjected ||
			!result.resetClearsArtifact
		) {
			throw new Error(`Expected pattern-memory harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:lane:medium harness: explicit 6-10 file work stays bounded and fail-closed beyond the lane", async () => {
		const result = await runMediumLaneHarness()
		const output = formatMediumLaneHarnessResult(result)
		if (!output.includes("Medium plan recorded")) {
			throw new Error(`Expected medium-lane output to mention the recorded plan, got: ${output}`)
		}
		if (
			!result.mediumTaskAdmitted ||
			!result.tooWideTaskRefused ||
			!result.mediumPlanRecorded ||
			!result.delegationContractVisible ||
			!result.teamShapeVisible ||
			!result.criticRequirementVisible ||
			!result.mediumLaneReliabilityVisible ||
			!result.refactorIntentVisible ||
			!result.corpusScoutVisible ||
			!result.modelClassificationBypassed ||
			!result.modeSelectorVisible
		) {
			throw new Error(`Expected medium-lane harness to pass all checks, got:\n${output}`)
		}
	})

	await runTest("verify:merge-order harness: dependency-aware sequencing stays explicit and blocks unsafe overlap", async () => {
		const result = await runMergeOrderHarness()
		const output = formatMergeOrderHarnessResult(result)
		if (!output.includes("Dependency order works")) {
			throw new Error(`Expected merge-order output to mention dependency order, got: ${output}`)
		}
		if (
			!result.dependencyOrderWorks ||
			!result.overlapHandlingWorks ||
			!result.branchNamesVisible ||
			!result.negotiationSurfaceVisible ||
			!result.readinessSurfaceVisible
		) {
			throw new Error("Expected merge-order harness to pass all checks")
		}
	})

	await runTest("verify:post-merge-quality harness: semantic gate stays visible after merge sequencing", async () => {
		const result = await runPostMergeQualityHarness()
		const output = formatPostMergeQualityHarnessResult(result)
		if (!output.includes("Passed with verification")) {
			throw new Error(`Expected post-merge-quality output to mention verification-backed pass, got: ${output}`)
		}
		if (
			!result.passedWithVerification ||
			!result.blockedWithoutCleanRun ||
			!result.omissionMetadataVisible ||
			!result.targetedMetadataVisible ||
			!result.approvalRiskVisible ||
			!result.summarySurfaceVisible
		) {
			throw new Error("Expected post-merge-quality harness to pass all checks")
		}
	})

	await runTest("verify:owner:beta fixtures: aggregate owner beta logic stays truthful", async () => {
		const result = await runOwnerBetaFixturesHarness()
		const output = formatOwnerBetaFixturesHarnessResult(result)
		if (!output.includes("Required evidence passes")) {
			throw new Error(`Expected owner beta fixtures output to mention required evidence, got: ${output}`)
		}
		if (
			!result.requiredEvidencePasses ||
			!result.smokeFailureBlocksBeta ||
			!result.missingCreditedRunBlocksBeta ||
			!result.betaCanBeReadyWhileRc1StillRed
		) {
			throw new Error("Expected owner beta fixtures harness to pass all checks")
		}
	})

	await runTest("verify:owner:clarity harness: owner-facing status and next actions stay explicit", async () => {
		const result = await runOwnerClarityHarness()
		const output = formatOwnerClarityHarnessResult(result)
		if (!output.includes("Prelaunch status visible")) {
			throw new Error(`Expected owner clarity output to mention prelaunch status, got: ${output}`)
		}
		if (
			!result.prelaunchStatusVisible ||
			!result.rc1ReasonVisible ||
			!result.reviewNextActionVisible ||
			!result.incidentNextActionVisible ||
			!result.calmDefaultVisible
		) {
			throw new Error("Expected owner clarity harness to pass all checks")
		}
	})

	await runTest("verify:owner:onboarding harness: repo onboarding stays deterministic and conservative", async () => {
		const result = await runOwnerOnboardingHarness()
		const output = formatOwnerOnboardingHarnessResult(result)
		if (!output.includes("Ready repo summary")) {
			throw new Error(`Expected owner onboarding output to mention ready repo summary, got: ${output}`)
		}
		if (
			!result.readyRepoSummary ||
			!result.missingProfileGuidance ||
			!result.missingKnowledgePackGuidance ||
			!result.refusedRepoSummary ||
			!result.scaffoldProfileWorks ||
			!result.scaffoldKnowledgePackWorks ||
			!result.discoveryPackVisible ||
			!result.firstRunStudySurfaced ||
			!result.pilotBatchVisible ||
			!result.contributorProofLoopVisible
		) {
			throw new Error("Expected owner onboarding harness to pass all checks")
		}
	})

	await runTest("verify:demo:run harness: disposable demo pack stays thin, resettable, and artifact-first", async () => {
		const result = await runDemoRunHarness()
		const output = formatDemoRunHarnessResult(result)
		if (!output.includes("Disposable workspace staged")) {
			throw new Error(`Expected demo harness output to mention disposable staging, got: ${output}`)
		}
		if (
			!result.disposableWorkspaceStaged ||
			!result.resetRemovesPreviousDrift ||
			!result.frozenProviderDefaultsApplied ||
			!result.passOutputShowsArtifactsAndDiffs ||
			!result.failOutputStaysCompact ||
			!result.resetOutputUseful ||
			!result.lowSteeringLoopVisible
		) {
			throw new Error("Expected demo run harness to pass all checks")
		}
	})

	await runTest("benchmark:head-to-head matrix: fixes the tool set and bounded task pack", () => {
		const matrix = buildHeadToHeadBenchmarkMatrix()
		if (matrix.matrixVersion !== "head_to_head_v1") {
			throw new Error(`Expected head_to_head_v1 matrix version, got: ${matrix.matrixVersion}`)
		}
		if (matrix.tools.map((tool) => tool.id).join(",") !== "swarmcoder_v2,roo_code,cline") {
			throw new Error(`Unexpected benchmark tools: ${matrix.tools.map((tool) => tool.id).join(", ")}`)
		}
		if (matrix.tasks.length !== 10) {
			throw new Error(`Expected 10 fixed benchmark tasks, got: ${matrix.tasks.length}`)
		}
		const requiredTaskIds = [
			"demo_pack_comment",
			"guided_note_file",
			"semiopen_helper_test_sync",
			"semiopen_docs_sync",
			"rename_export_direct_calls",
			"docs_bundle_readme_faq_sync",
			"explicit_config_file_update",
			"scoped_two_file_update",
			"explicit_medium_six_file_sync",
			"cross_language_reporter_sync",
		]
		if (!requiredTaskIds.every((taskId) => matrix.tasks.some((task) => task.id === taskId))) {
			throw new Error(`Expected benchmark task ids ${requiredTaskIds.join(", ")}, got: ${matrix.tasks.map((task) => task.id).join(", ")}`)
		}
		if (matrix.tasks.some((task) => !task.workspaceFixture.startsWith("verification/"))) {
			throw new Error("Expected every benchmark task to stay inside verification fixtures")
		}
		if (!matrix.rules.some((rule) => rule.includes("Do not change V2 runtime behavior"))) {
			throw new Error("Expected benchmark rules to block runtime changes for benchmark wins")
		}
	})

	await runTest("benchmark:head-to-head report: prefers the recorded study and keeps the shipped template aligned", () => {
		const expectedTemplate = `${JSON.stringify(buildHeadToHeadStudyTemplate(), null, 2)}\n`
		const templatePath = path.join(ROOT, HEAD_TO_HEAD_STUDY_TEMPLATE_RELATIVE_PATH)
		const actualTemplate = fs.readFileSync(templatePath, "utf8")
		if (actualTemplate !== expectedTemplate) {
			throw new Error(`Expected shipped benchmark study template to match the generated template at ${templatePath}`)
		}

		const templateReport = buildHeadToHeadBenchmarkReport(ROOT, templatePath)
		const templateOutput = formatHeadToHeadBenchmarkReport(templateReport)
		if (!templateOutput.includes("Head-to-head benchmark matrix")) {
			throw new Error(`Expected benchmark report header, got: ${templateOutput}`)
		}
		if (!templateOutput.includes("Task sample coverage: 10/10 task families across 10 fixed row(s)")) {
			throw new Error(`Expected expanded task-family coverage line, got: ${templateOutput}`)
		}
		if (!templateOutput.includes("SwarmCoder V2: pass=0 partial=0 fail=0 unsupported=0 not_run=10")) {
			throw new Error(`Expected empty V2 summary row, got: ${templateOutput}`)
		}
		if (!templateOutput.includes("Roo Code: NOT RUN") || !templateOutput.includes("Cline: NOT RUN")) {
			throw new Error(`Expected template benchmark report to preserve NOT RUN competitor rows, got: ${templateOutput}`)
		}

		const report = buildHeadToHeadBenchmarkReport(ROOT)
		if (report.studySource !== HEAD_TO_HEAD_STUDY_RELATIVE_PATH) {
			throw new Error(`Expected default benchmark report to prefer the recorded study, got: ${report.studySource}`)
		}
		const output = formatHeadToHeadBenchmarkReport(report)
		if (!output.includes("code --list-extensions")) {
			throw new Error(`Expected recorded study notes to mention the local extension audit, got: ${output}`)
		}
	})

	await runTest("benchmark:queenbee:small harness: compares shipped one-file swarmengine evidence against the candidate queenbee shell", async () => {
		const result = await runQueenBeeSmallComparisonHarness()
		const output = formatQueenBeeSmallComparisonHarnessResult(result)
		if (!output.includes("Swarmengine small lane visible: PASS")) {
			throw new Error(`Expected comparison output to mention the shipped small lane, got: ${output}`)
		}
		if (!output.includes("QueenBee protocol visible: PASS")) {
			throw new Error(`Expected comparison output to mention the QueenBee protocol lane, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.comparisonDocsPresent ||
			!result.comparisonStayedCandidateOnly ||
			!result.sameTaskFamilyVisible ||
			!result.swarmengineTaskAdmitted ||
			!result.swarmengineSummaryPresent ||
			!result.swarmengineSmallLaneVisible ||
			!result.swarmengineScopeStayedBounded ||
			!result.swarmengineArtifactTruthVisible ||
			!result.queenbeeProtocolVisible ||
			!result.queenbeeScopeStayedBounded
		) {
			throw new Error("Expected QueenBee small comparison harness to pass all checks")
		}
	})

	await runTest("benchmark:queenbee:two-file harness: records a mixed confidence-versus-ceremony judgment for the candidate shell", async () => {
		const result = await runQueenBeeTwoFileComparisonHarness()
		const output = formatQueenBeeTwoFileComparisonHarnessResult(result)
		if (!output.includes("User-confidence review recorded: PASS")) {
			throw new Error(`Expected two-file comparison output to mention the UX review, got: ${output}`)
		}
		if (!output.includes("Protocol value versus ceremony judged: PASS")) {
			throw new Error(`Expected two-file comparison output to judge value versus ceremony, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.comparisonDocsPresent ||
			!result.userConfidenceReviewRecorded ||
			!result.protocolValueVsCeremonyJudged ||
			!result.sameTaskFamilyVisible ||
			!result.swarmengineTaskAdmitted ||
			!result.swarmengineSummaryPresent ||
			!result.swarmengineScopedLaneVisible ||
			!result.swarmengineScopeStayedBounded ||
			!result.swarmengineArtifactTruthVisible ||
			!result.queenbeeTwoFileLaneVisible ||
			!result.queenbeeScopeStayedBounded ||
			!result.queenbeeCompletionEvidenceVisible
		) {
			throw new Error("Expected QueenBee two-file comparison harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:gate1 harness: keeps expansion truthfully on HOLD until confidence gains outweigh ceremony", async () => {
		const result = await runQueenBeeGateOneHarness()
		const output = formatQueenBeeGateOneHarnessResult(result)
		if (!output.includes("Gate doc says HOLD: PASS")) {
			throw new Error(`Expected gate-one output to preserve the HOLD answer, got: ${output}`)
		}
		if (!output.includes("Readme boundary aligned: PASS")) {
			throw new Error(`Expected gate-one output to confirm README alignment, got: ${output}`)
		}
		if (
			!result.comparisonProofsGreen ||
			!result.gateDocPresent ||
			!result.gateDocSaysHold ||
			!result.blockerListPresent ||
			!result.readmeBoundaryAligned ||
			!result.architectureDecisionRecorded
		) {
			throw new Error("Expected QueenBee gate-one harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:beta-contract harness: widened beta target stays candidate-only and separate from the older live slice", async () => {
		const result = await runQueenBeeBetaContractHarness()
		const output = formatQueenBeeBetaContractHarnessResult(result)
		if (!output.includes("Candidate beta contract present: PASS")) {
			throw new Error(`Expected beta-contract output to confirm the widened candidate contract, got: ${output}`)
		}
		if (!output.includes("Specialist selection story explicit: PASS")) {
			throw new Error(`Expected beta-contract output to confirm the specialist story, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.readmeRoadmapAligned ||
			!result.candidateBetaContractPresent ||
			!result.firstSliceBetaTargetPresent ||
			!result.specialistSelectionStoryExplicit ||
			!result.taskCorpusAligned ||
			!result.verificationCatalogAligned ||
			!result.architectureDecisionRecorded
		) {
			throw new Error("Expected QueenBee beta-contract harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:jsts:core harness: the bounded coder slot now names JSTSCoreBee as the live core specialist", async () => {
		const result = await runQueenBeeJstsCoreHarness()
		const output = formatQueenBeeJstsCoreHarnessResult(result)
		if (!output.includes("Core selected by default: PASS")) {
			throw new Error(`Expected JSTS core output to confirm default specialist selection, got: ${output}`)
		}
		if (!output.includes("Route slot stayed generic: PASS")) {
			throw new Error(`Expected JSTS core output to preserve the generic route slot, got: ${output}`)
		}
		if (
			!result.coreDocsPresent ||
			!result.packageScriptPresent ||
			!result.specialistListVisible ||
			!result.coreSelectedByDefault ||
			!result.assignmentDelivered ||
			!result.coreSummaryVisible ||
			!result.routeSlotStayedGeneric ||
			!result.proposalStayedScoped
		) {
			throw new Error("Expected QueenBee JSTS core harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:router harness: RouterBee keeps the same bounded edges while surfacing the core specialist", async () => {
		const result = await runQueenBeeRouterHarness()
		const output = formatQueenBeeRouterHarnessResult(result)
		if (!output.includes("Core specialist visible: PASS")) {
			throw new Error(`Expected router output to confirm the core specialist is visible, got: ${output}`)
		}
		if (
			!result.routerDocsPresent ||
			!result.routeTableAligned ||
			!result.implementedEdgesScoped ||
			!result.registryLookupDelivered ||
			!result.plannerPlanDelivered ||
			!result.coderWorkDelivered ||
			!result.coreSpecialistVisible ||
			!result.reviewVerdictDelivered ||
			!result.verificationDelivered ||
			!result.mergeDelivered ||
			!result.archiveWritten ||
			!result.recoveryDelivered ||
			!result.forbiddenDirectEdgeRejected ||
			!result.messageTypeBoundaryEnforced
		) {
			throw new Error("Expected QueenBee router harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:jsts:async harness: async-sensitive work now selects JSTSAsyncBee inside the bounded coder slot", async () => {
		const result = await runQueenBeeJstsAsyncHarness()
		const output = formatQueenBeeJstsAsyncHarnessResult(result)
		if (!output.includes("Async selected: PASS")) {
			throw new Error(`Expected JSTS async output to confirm async specialist selection, got: ${output}`)
		}
		if (!output.includes("Route slot stayed generic: PASS")) {
			throw new Error(`Expected JSTS async output to preserve the generic route slot, got: ${output}`)
		}
		if (
			!result.asyncDocsPresent ||
			!result.packageScriptPresent ||
			!result.asyncSpecialistListed ||
			!result.asyncSelected ||
			!result.assignmentDelivered ||
			!result.asyncSummaryVisible ||
			!result.routeSlotStayedGeneric ||
			!result.proposalStayedScoped
		) {
			throw new Error("Expected QueenBee JSTS async harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:selection harness: core, async, and node specialist choices stay inspectable and bounded", async () => {
		const result = await runQueenBeeSelectionHarness()
		const output = formatQueenBeeSelectionHarnessResult(result)
		if (!output.includes("Core wins plain task: PASS")) {
			throw new Error(`Expected selection output to preserve the core default, got: ${output}`)
		}
		if (!output.includes("Async wins async task: PASS")) {
			throw new Error(`Expected selection output to confirm async routing, got: ${output}`)
		}
		if (!output.includes("Node wins node task: PASS")) {
			throw new Error(`Expected selection output to confirm node routing, got: ${output}`)
		}
		if (
			!result.selectionDocsPresent ||
			!result.packageScriptPresent ||
			!result.specialistListVisible ||
			!result.coreWinsPlainTask ||
			!result.asyncWinsAsyncTask ||
			!result.nodeWinsNodeTask ||
			!result.selectionStayedBounded
		) {
			throw new Error("Expected QueenBee selection harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:jsts:node harness: Node/CLI-sensitive work now selects JSTSNodeBee inside the bounded coder slot", async () => {
		const result = await runQueenBeeJstsNodeHarness()
		const output = formatQueenBeeJstsNodeHarnessResult(result)
		if (!output.includes("Node selected: PASS")) {
			throw new Error(`Expected JSTS node output to confirm node specialist selection, got: ${output}`)
		}
		if (!output.includes("Proposal stayed scoped: PASS")) {
			throw new Error(`Expected JSTS node output to stay scoped, got: ${output}`)
		}
		if (
			!result.nodeDocsPresent ||
			!result.packageScriptPresent ||
			!result.nodeSpecialistListed ||
			!result.nodeSelected ||
			!result.assignmentDelivered ||
			!result.nodeSummaryVisible ||
			!result.routeSlotStayedGeneric ||
			!result.proposalStayedScoped
		) {
			throw new Error("Expected QueenBee JSTS node harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:bounded-node harness: bounded Node/CLI planning stays explicit and fail-closed beyond one or two targets", async () => {
		const result = await runQueenBeeBoundedNodeHarness()
		const output = formatQueenBeeBoundedNodeHarnessResult(result)
		if (!output.includes("Node lane stayed bounded: PASS")) {
			throw new Error(`Expected bounded-node output to confirm the fail-closed target cap, got: ${output}`)
		}
		if (
			!result.nodeLaneDocsPresent ||
			!result.packageScriptPresent ||
			!result.plannerSupportsNodeFamily ||
			!result.nodePlanDelivered ||
			!result.assignmentPacketExplicit ||
			!result.nodeLaneStayedBounded ||
			!result.routeSlotStayedGeneric
		) {
			throw new Error("Expected QueenBee bounded node harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:jsts:rename harness: bounded rename_export work stays symbol-scoped and core-routed", async () => {
		const result = await runQueenBeeJstsRenameHarness()
		const output = formatQueenBeeJstsRenameHarnessResult(result)
		if (!output.includes("Core selected for rename: PASS")) {
			throw new Error(`Expected rename output to keep rename_export on the core specialist, got: ${output}`)
		}
		if (!output.includes("Symbol scope fail-closed: PASS")) {
			throw new Error(`Expected rename output to fail closed on ambiguous source exports, got: ${output}`)
		}
		if (
			!result.renameDocsPresent ||
			!result.publicDocsTruthful ||
			!result.packageScriptPresent ||
			!result.coreSelectedForRename ||
			!result.assignmentDelivered ||
			!result.routeSlotStayedGeneric ||
			!result.renameStayedScoped ||
			!result.symbolScopeFailClosed
		) {
			throw new Error("Expected QueenBee JSTS rename harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:jsts:file-and-test harness: bounded source-and-test work stays explicit and test-routed by default", async () => {
		const result = await runQueenBeeJstsFileAndTestHarness()
		const output = formatQueenBeeJstsFileAndTestHarnessResult(result)
		if (!output.includes("Test selected for file-and-test: PASS")) {
			throw new Error(`Expected file-and-test output to keep the calm default on the test specialist, got: ${output}`)
		}
		if (!output.includes("Lane stayed bounded: PASS")) {
			throw new Error(`Expected file-and-test output to fail closed on non-test pairs, got: ${output}`)
		}
		if (
			!result.fileAndTestDocsPresent ||
			!result.publicDocsTruthful ||
			!result.packageScriptPresent ||
			!result.plannerSupportsFamily ||
			!result.testSelectedForFileAndTest ||
			!result.assignmentDelivered ||
			!result.assignmentPacketExplicit ||
			!result.routeSlotStayedGeneric ||
			!result.laneStayedBounded
		) {
			throw new Error("Expected QueenBee JSTS file-and-test harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:ux harness: candidate CLI boundary stays truthful while shedding stale protocol ceremony", async () => {
		const result = await runQueenBeeUxHarness()
		const output = formatQueenBeeUxHarnessResult(result)
		if (!output.includes("CLI family hint visible: PASS")) {
			throw new Error(`Expected UX output to surface the bounded family hint, got: ${output}`)
		}
		if (!output.includes("CLI ceremony reduced: PASS")) {
			throw new Error(`Expected UX output to confirm stale ceremony was removed, got: ${output}`)
		}
		if (
			!result.uxDocsPresent ||
			!result.publicDocsTruthful ||
			!result.packageScriptPresent ||
			!result.runtimeMessageCalmer ||
			!result.runtimeMessageTruthful ||
			!result.cliFamilyHintVisible ||
			!result.cliCeremonyReduced
		) {
			throw new Error("Expected QueenBee UX harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:beta-gate harness: final bounded beta answer stays experimental and six-family explicit", async () => {
		const result = await runQueenBeeBetaGateHarness()
		const output = formatQueenBeeBetaGateHarnessResult(result)
		if (!output.includes("Beta gate doc present: PASS")) {
			throw new Error(`Expected QueenBee beta-gate output to confirm the gate doc, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.betaGateDocPresent ||
			!result.proofBundleExplicit ||
			!result.sixFamilySetExplicit ||
			!result.readmeGateAligned ||
			!result.verificationCatalogAligned ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected QueenBee beta-gate harness to pass all checks")
		}
	})

	await runTest("verify:queenbee:control-stack harness: targeted next-band gate stays bounded, singleton, and explicit", async () => {
		const result = await runQueenBeeControlStackHarness()
		const output = formatQueenBeeControlStackHarnessResult(result)
		if (!output.includes("Gate doc present: PASS")) {
			throw new Error(`Expected QueenBee control-stack output to confirm the gate doc, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.gateDocPresent ||
			!result.supportMatrixExplicit ||
			!result.nextBandAnswerExplicit ||
			!result.singletonAndCloneAnswerExplicit ||
			!result.controlStackAnchorsPreserved ||
			!result.traceabilityAligned ||
			!result.gapRegisterAligned ||
			!result.reverseEngineeringAligned ||
			!result.parallelModelAligned ||
			!result.architectureDecisionRecorded ||
			!result.verificationCatalogAligned ||
			!result.capabilityChecklistAligned ||
			!result.betaBoundaryPreserved
		) {
			throw new Error("Expected QueenBee control-stack harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:scaffold harness: future public export stays curated and private-lab history stays out", async () => {
		const result = await runPublicPackScaffoldHarness()
		const output = formatPublicPackScaffoldHarnessResult(result)
		if (!output.includes("Manifest blocks private-lab history: PASS")) {
			throw new Error(`Expected public-pack scaffold output to block private-lab history, got: ${output}`)
		}
		if (!output.includes("Root README boundary aligned: PASS")) {
			throw new Error(`Expected public-pack scaffold output to confirm root README alignment, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.scaffoldReadmePresent ||
			!result.boundaryDocPresent ||
			!result.manifestPresent ||
			!result.manifestListsExistingPackFiles ||
			!result.manifestBlocksPrivateLabHistory ||
			!result.readmeBoundaryAligned ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack scaffold harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:branding harness: Queenshift public naming stays locked without renaming the engines", async () => {
		const result = await runPublicPackBrandingHarness()
		const output = formatPublicPackBrandingHarnessResult(result)
		if (!output.includes("Brand lock doc present: PASS")) {
			throw new Error(`Expected public-pack branding output to confirm the brand-lock doc, got: ${output}`)
		}
		if (!output.includes("Root README aligned: PASS")) {
			throw new Error(`Expected public-pack branding output to confirm root README alignment, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.brandLockDocPresent ||
			!result.assetManifestPresent ||
			!result.brandingReadmeOrganized ||
			!result.exportManifestIncludesBrandFiles ||
			!result.rootReadmeAligned ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack branding harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:readme harness: future public README stays stranger-first and bounded", async () => {
		const result = await runPublicPackReadmeHarness()
		const output = formatPublicPackReadmeHarnessResult(result)
		if (!output.includes("Public README stays bounded: PASS")) {
			throw new Error(`Expected public-pack readme output to confirm bounded copy, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.publicReadmePresent ||
			!result.publicReadmeStaysBounded ||
			!result.exportManifestIncludesPublicDocs ||
			!result.publicDocsIndexPresent ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack readme harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:quickstart harness: public quickstart keeps the first path calm and truthful", async () => {
		const result = await runPublicPackQuickstartHarness()
		const output = formatPublicPackQuickstartHarnessResult(result)
		if (!output.includes("Quickstart stays truthful: PASS")) {
			throw new Error(`Expected public-pack quickstart output to confirm truthful copy, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.quickstartPresent ||
			!result.quickstartStaysTruthful ||
			!result.exportManifestIncludesQuickstart ||
			!result.publicDocsIndexPresent
		) {
			throw new Error("Expected public-pack quickstart harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:onboarding harness: future public onboarding docs stay bounded and linked", async () => {
		const result = await runPublicPackOnboardingHarness()
		const output = formatPublicPackOnboardingHarnessResult(result)
		if (!output.includes("Install doc present: PASS")) {
			throw new Error(`Expected public-pack onboarding output to confirm the install doc, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.installDocPresent ||
			!result.providerDocPresent ||
			!result.taskFamiliesDocPresent ||
			!result.docsIndexLinked ||
			!result.exportManifestIncludesOnboardingDocs ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack onboarding harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:issue-templates harness: public issue intake stays artifact-backed and bounded", async () => {
		const result = await runPublicPackIssueTemplatesHarness()
		const output = formatPublicPackIssueTemplatesHarnessResult(result)
		if (!output.includes("Bug template present: PASS")) {
			throw new Error(`Expected public-pack issue-template output to confirm the bug template, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.bugTemplatePresent ||
			!result.taskFamilyTemplatePresent ||
			!result.exportManifestIncludesIssueTemplates
		) {
			throw new Error("Expected public-pack issue-templates harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:release-docs harness: community and release files stay coherent for a fresh public repo", async () => {
		const result = await runPublicPackReleaseDocsHarness()
		const output = formatPublicPackReleaseDocsHarnessResult(result)
		if (!output.includes("License present: PASS")) {
			throw new Error(`Expected public-pack release-docs output to confirm the license surface, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.authorsDocPresent ||
			!result.citationDocPresent ||
			!result.changelogPresent ||
			!result.contributingDocPresent ||
			!result.codeOfConductPresent ||
			!result.securityDocPresent ||
			!result.licensePresent ||
			!result.exportManifestIncludesReleaseDocs ||
			!result.publicReadmeReferencesReleaseDocs ||
			!result.boundaryDocListsReleaseDocs ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack release-docs harness to pass all checks")
		}
	})

	await runTest("verify:public-pack:export harness: fresh public handoff stays explicit and visibility-flip-safe", async () => {
		const result = await runPublicPackExportHarness()
		const output = formatPublicPackExportHarnessResult(result)
		if (!output.includes("Manifest status export-ready: PASS")) {
			throw new Error(`Expected public-pack export output to confirm export-ready status, got: ${output}`)
		}
		if (
			!result.packageScriptPresent ||
			!result.exportGateDocPresent ||
			!result.handoffDocPresent ||
			!result.manifestStatusExportReady ||
			!result.manifestFileMapExplicit ||
			!result.boundaryStillFreshRepoOnly ||
			!result.readmeGateAligned ||
			!result.architectureDecisionRecorded ||
			!result.capabilityChecklistAligned
		) {
			throw new Error("Expected public-pack export harness to pass all checks")
		}
	})

	await runTest("verify:owner:launcher harness: one-click owner demo stays thin, canonical, and compact", async () => {
		const result = await runOwnerLauncherHarness()
		const output = formatOwnerLauncherHarnessResult(result)
		if (!output.includes("Canonical workspace selected")) {
			throw new Error(`Expected owner launcher output to mention canonical workspace selection, got: ${output}`)
		}
		if (
			!result.canonicalWorkspaceSelected ||
			!result.canonicalProviderDefaultsApplied ||
			!result.passOutputCompact ||
			!result.failureOutputCompact ||
			!result.manifestExposed
		) {
			throw new Error("Expected owner launcher harness to pass all checks")
		}
	})

	await runTest("verify:owner:profile-manifest harness: canonical owner profile stays frozen and drift-safe", async () => {
		const result = await runOwnerProfileManifestHarness()
		const output = formatOwnerProfileManifestHarnessResult(result)
		if (!output.includes("Manifest drift fails closed")) {
			throw new Error(`Expected owner profile manifest output to mention drift protection, got: ${output}`)
		}
		if (!result.manifestCreated || !result.manifestStable || !result.driftFailsClosed || !result.manifestFieldsVisible) {
			throw new Error("Expected owner profile manifest harness to pass all checks")
		}
	})

	await runTest("verify:owner:surface harness: canonical owner path stays frozen across docs and scripts", async () => {
		const result = await runOwnerSurfaceHarness()
		const output = formatOwnerSurfaceHarnessResult(result)
		if (!output.includes("Canonical scripts present")) {
			throw new Error(`Expected owner surface output to mention canonical scripts, got: ${output}`)
		}
		if (
			!result.canonicalScriptsPresent ||
			!result.readmeCanonicalFlowAligned ||
			!result.quickstartCanonicalFlowAligned ||
			!result.oversightCanonicalFlowAligned ||
			!result.releaseNotesCanonicalFlowAligned ||
			!result.followUpSurfaceAligned ||
			!result.canonicalDocsDemoteLegacyDefaults ||
			!result.lowSteeringLoopDocsPresent ||
			!result.failureNarrativeDocsPresent ||
			!result.boundedReleaseChecklistPresent ||
			!result.boundedSupportRunbookPresent ||
			!result.supportIssueIntakeGuidePresent ||
			!result.bugTemplateAligned ||
			!result.outcomeDashboardDocsPresent ||
			!result.publicBetaOperationsDocsPresent ||
			!result.shipFirstReadinessDocsPresent ||
			!result.contributorSourceCheckoutDocsPresent ||
			!result.contributorProofLoopDocsPresent ||
			!result.adapterDocsPresent ||
			!result.largeRepoBetaDocsPresent ||
			!result.comparativeBenchmarkDocsPresent ||
			!result.generalUseRcGateDocsPresent ||
			!result.generalUseDecisionDocsPresent
		) {
			throw new Error("Expected owner surface harness to pass all checks")
		}
	})

	await runTest("verify:rc1:ops harness: auto-credit and fail-closed streak fixtures pass", async () => {
		const result = await runRc1OpsHarness()
		const output = formatRc1OpsHarnessResult(result)
		if (!output.includes("Auto-credit success: PASS")) {
			throw new Error(`Expected RC1 ops harness output to mention auto-credit PASS, got: ${output}`)
		}
		if (
			!result.autoCreditSuccess ||
			!result.duplicateProtection ||
			!result.invalidRunRejected ||
			!result.perDayCapEnforced ||
			!result.threeDateRuleEnforced ||
			!result.statusOutputClear ||
			!result.verifyRc1FailCloses
		) {
			throw new Error("Expected RC1 ops harness to pass all checks")
		}
	})

	await runTest("verify:rc1 recorded-proof evaluator: requires fresh dated PASS evidence", () => {
		const readmeText = [
			"- Current matrix verification: PASS (`npm.cmd run verify:live:matrix` -> 12/12 rows on 2026-03-20; `npm.cmd run forensics:matrix:latest` -> `Failure buckets: none`)",
			"- Manual owner confirmation: PASS (Extension Development Host launch plus `Ctrl+Shift+P` command discovery on 2026-03-21)",
		].join("\n")

		const fresh = evaluateRecordedProofGate(
			readmeText,
			{
				key: "matrix",
				label: "Live matrix proof",
				proofLabel: "Current matrix verification",
				maxAgeDays: 3,
			},
			new Date("2026-03-21T12:00:00Z"),
		)
		if (fresh.status !== "PASS") {
			throw new Error(`Expected fresh recorded proof to PASS, got ${fresh.status}: ${fresh.details.join(" | ")}`)
		}

		const stale = evaluateRecordedProofGate(
			readmeText,
			{
				key: "matrix",
				label: "Live matrix proof",
				proofLabel: "Current matrix verification",
				maxAgeDays: 1,
			},
			new Date("2026-03-23T12:00:00Z"),
		)
		if (stale.status !== "FAIL") {
			throw new Error(`Expected stale recorded proof to FAIL, got ${stale.status}: ${stale.details.join(" | ")}`)
		}
	})

	await runTest("verify:rc1 daily-driver evaluator: enforces credited multi-day streak rules", () => {
		const empty = evaluateDailyDriverLog({ version: 1, entries: [] }, DEFAULT_DAILY_DRIVER_RULES)
		if (empty.passed) {
			throw new Error("Expected an empty daily-driver log to fail")
		}

		const passing = evaluateDailyDriverLog(
			{
				version: 1,
				entries: [
					{
						date: "2026-03-18",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 1",
						runId: "run-1",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-18",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 2",
						runId: "run-2",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-18",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 3",
						runId: "run-3",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "not_applicable",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-18",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 4",
						runId: "run-4",
						surface: "cli",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-19",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 5",
						runId: "run-5",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-19",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 6",
						runId: "run-6",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-19",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 7",
						runId: "run-7",
						surface: "cli",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-20",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 8",
						runId: "run-8",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-20",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 9",
						runId: "run-9",
						surface: "thin_shell_guided",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
					{
						date: "2026-03-20",
						workspace: "verification/dogfood_repo_copy_final",
						task: "task 10",
						runId: "run-10",
						surface: "cli",
						terminalStatus: "done",
						reviewerVerdict: "PASS",
						acceptanceGate: "passed",
						verificationProfile: "passed",
						manualRepair: false,
						credited: true,
					},
				],
			},
			DEFAULT_DAILY_DRIVER_RULES,
		)
		if (!passing.passed) {
			throw new Error(`Expected a 10-run / 3-day streak to pass, got: ${passing.details.join(" | ")}`)
		}
	})

	await runTest("verify:rc1 status helper: reads daily-driver progress without rerunning full automation", () => {
		const harnessRoot = path.join(ROOT, "verification", `.tmp-rc1-status-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		fs.mkdirSync(harnessRoot, { recursive: true })
		fs.writeFileSync(
			path.join(harnessRoot, "RC1_DAILY_DRIVER_LOG.json"),
			`${JSON.stringify(
				{
					version: 1,
					entries: [
						{
							date: "2026-03-21",
							workspace: "C:\\OwnerRepo",
							task: "owner run",
							runId: "run-1",
							surface: "thin_shell_guided",
							terminalStatus: "done",
							reviewerVerdict: "PASS",
							acceptanceGate: "passed",
							verificationProfile: "not_applicable",
							manualRepair: false,
							credited: true,
							notes: "Credited owner run.",
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf8",
		)

		try {
			const result = runRc1Status(harnessRoot, new Date("2026-03-21T12:00:00.000Z"))
			const output = formatRc1StatusResult(result)
			if (!output.includes("RC1 daily-driver gate: FAIL")) {
				throw new Error(`Expected RC1 status output to include the daily-driver gate result, got: ${output}`)
			}
			if (!output.includes("RC1 daily-driver progress: 1/10 runs, 1/3 dates")) {
				throw new Error(`Expected RC1 status output to summarize credited progress, got: ${output}`)
			}
			if (!output.includes("Remaining for RC1 closeout: 9 run(s), 2 distinct date(s)")) {
				throw new Error(`Expected RC1 status output to summarize remaining closeout work, got: ${output}`)
			}
			if (!output.includes("Current date still has 3 credited slot(s) left; next eligible credited date: 2026-03-21")) {
				throw new Error(`Expected RC1 status output to summarize the current credit window, got: ${output}`)
			}
			if (output.includes("Automation gates:")) {
				throw new Error(`Expected RC1 status output to skip the full automation table, got: ${output}`)
			}
		} finally {
			if (fs.existsSync(harnessRoot)) fs.rmSync(harnessRoot, { recursive: true, force: true })
		}
	})

	await runTest("verify:rc1 auto-credit: passive recovery metadata does not imply manualRepair", () => {
		const harnessRoot = path.join(ROOT, "verification", `.tmp-rc1-manualrepair-${Date.now()}-${Math.random().toString(16).slice(2)}`)
		const workspace = path.join(harnessRoot, "owner-repo")
		fs.mkdirSync(workspace, { recursive: true })
		fs.writeFileSync(path.join(harnessRoot, "package.json"), `${JSON.stringify({ name: "rc1-manualrepair-test" }, null, 2)}\n`, "utf8")
		fs.writeFileSync(path.join(harnessRoot, "Readme.md"), "# RC1 Harness\n", "utf8")

		try {
			const passiveRunDir = ensureRunDir(workspace, "passive-recovery-run")
			const passiveSummaryPath = writeRunSummary(passiveRunDir, {
				taskId: "passive-recovery-run",
				task: "owner run with passive recovery metadata",
				workspace,
				dryRun: false,
				startedAt: "2026-03-21T08:00:00.000Z",
				endedAt: "2026-03-21T08:05:00.000Z",
				status: "done",
				reviewerVerdict: "PASS",
				acceptanceGate: { passed: true },
				verificationProfile: null,
				recovery: {
					orphanedWorktrees: [],
					orphanedSwarmBranches: [],
					staleTmpEntries: [],
					incompleteRunArtifacts: [],
					warnings: ["startup inventory only"],
				},
			})
			const passive = recordDailyDriverFromSummaryPath(harnessRoot, passiveSummaryPath, new Date("2026-03-21T09:00:00.000Z"))
			if (passive.decision !== "credited" || passive.entry?.manualRepair !== false) {
				throw new Error(`Expected passive recovery run to be credited without manual repair, got ${passive.decision} (${passive.reason})`)
			}

			const repairedRunDir = ensureRunDir(workspace, "manual-repair-run")
			const repairedSummaryPath = writeRunSummary(repairedRunDir, {
				taskId: "manual-repair-run",
				task: "owner run that required manual repair",
				workspace,
				dryRun: false,
				startedAt: "2026-03-21T09:10:00.000Z",
				endedAt: "2026-03-21T09:15:00.000Z",
				status: "done",
				reviewerVerdict: "PASS",
				acceptanceGate: { passed: true },
				verificationProfile: null,
				recovery: {
					manualRepair: true,
					repair: {
						manualIntervention: true,
					},
				},
			})
			const repaired = recordDailyDriverFromSummaryPath(harnessRoot, repairedSummaryPath, new Date("2026-03-21T09:16:00.000Z"))
			if (repaired.decision !== "rejected" || repaired.entry?.manualRepair !== true || !repaired.reason.includes("manualRepair=true")) {
				throw new Error(`Expected explicit manual repair run to be rejected, got ${repaired.decision} (${repaired.reason})`)
			}
		} finally {
			if (fs.existsSync(harnessRoot)) fs.rmSync(harnessRoot, { recursive: true, force: true })
		}
	})

	await runTest("verify:rc1 formatter: prints ship decision and blockers", () => {
		const output = formatRc1VerificationResult({
			shipDecision: "NO_SHIP",
			automationPassed: true,
			recordedProofsPassed: false,
			dailyDriverPassed: false,
			gates: [
				{
					key: "level1",
					label: "Level 1 tests",
					mode: "command",
					required: true,
					status: "PASS",
					source: "npm test",
					details: ["exit=0"],
				},
				{
					key: "matrix",
					label: "Live matrix proof",
					mode: "recorded_proof",
					required: true,
					status: "FAIL",
					source: "Readme.md",
					recordedDate: "2026-03-10",
					details: ["Recorded proof is stale: 11 day(s) old, max allowed is 7."],
				},
				{
					key: "daily_driver",
					label: "Daily-driver streak log",
					mode: "daily_driver",
					required: true,
					status: "FAIL",
					source: "RC1_DAILY_DRIVER_LOG.json",
					details: ["Credited runs: 0/10.", "Distinct dates: 0/3."],
				},
			],
			dailyDriver: {
				passed: false,
				creditedCount: 0,
				requiredCreditedRuns: 10,
				distinctDateCount: 0,
				requiredDistinctDates: 3,
				maxCreditedRunsPerDay: 4,
				maxObservedPerDay: 0,
				overfilledDates: [],
				invalidCreditedEntries: [],
				details: ["Credited runs: 0/10.", "Distinct dates: 0/3."],
			},
			dailyDriverStatus: {
				currentDate: "2026-03-21",
				creditedCount: 0,
				requiredCreditedRuns: 10,
				distinctDateCount: 0,
				requiredDistinctDates: 3,
				currentDateCreditedCount: 0,
				maxCreditedRunsPerDay: 4,
				latestCredited: null,
				latestRejected: {
					date: "2026-03-21",
					workspace: "D:\\OwnerRepo",
					task: "dry-run smoke",
					runId: "run-rejected",
					surface: "cli_artifact",
					terminalStatus: "review_required",
					reviewerVerdict: "PASS",
					acceptanceGate: "failed",
					verificationProfile: "not_applicable",
					manualRepair: false,
					credited: false,
					notes: "Not credited: status=review_required, acceptanceGate=failed",
				},
			},
			blockedOnlyByRealStreak: false,
			blockers: [
				"Live matrix proof: Recorded proof is stale: 11 day(s) old, max allowed is 7.",
				"Daily-driver streak log: Credited runs: 0/10.",
			],
		})

		if (!output.includes("RC1 decision: NO-SHIP")) {
			throw new Error(`Expected formatter to include the ship decision, got: ${output}`)
		}
		if (!output.includes("Daily-driver streak: FAIL (0/10 runs, 0/3 dates)")) {
			throw new Error(`Expected formatter to summarize the daily-driver streak, got: ${output}`)
		}
		if (!output.includes("Ship blockers:")) {
			throw new Error(`Expected formatter to list ship blockers, got: ${output}`)
		}
	})

	await runTest("verify:vscode:shell chooser: skips refused workspaces and picks a clean repo", async () => {
		const dirtyRepo = await createTempRepoCopy("vscode-shell-dirty-default")
		const safeRepo = await createTempRepoCopy("vscode-shell-safe-default")
		const missingRepo = path.join(
			ROOT,
			"verification",
			`.tmp-vscode-shell-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)

		try {
			fs.appendFileSync(path.join(dirtyRepo.repoPath, "UNTRACKED_SHELL_DEFAULT.txt"), "dirty\n", "utf8")

			const selectedWorkspace = await chooseInitialShellWorkspace([dirtyRepo.repoPath, safeRepo.repoPath])
			if (selectedWorkspace !== safeRepo.repoPath) {
				throw new Error(`Expected chooser to skip dirty repo and pick clean repo, got: ${selectedWorkspace || "(empty)"}`)
			}

			const noSafeWorkspace = await chooseInitialShellWorkspace([dirtyRepo.repoPath, missingRepo])
			if (noSafeWorkspace !== "") {
				throw new Error(`Expected chooser to return an empty workspace when all candidates are unsafe, got: ${noSafeWorkspace}`)
			}
		} finally {
			dirtyRepo.cleanup()
			safeRepo.cleanup()
		}
	})

	await runTest("verify:vscode:shell formatter: prints PASS/FAIL rows", () => {
		const output = formatVscodeShellSmokeResult({
			passed: true,
			ownerSafeDefaultWorkspace: true,
			session18TaskLaunch: true,
			session18SummarySurfaced: true,
			session18ForensicsSurfaced: true,
			session19ReviewInboxSurfaced: true,
			session19DiscardAction: true,
			workspace: TEST_WORKSPACE,
			session18SummaryPath: path.join(TEST_WORKSPACE, ".swarm", "runs", "task-1", "summary.json"),
			reviewRunId: "task-2",
			details: ["example"],
			error: null,
		})
		if (!output.includes("PASS")) throw new Error("Expected VS Code shell smoke formatter to include PASS")
		if (!output.includes("Session 19 discard action: PASS")) {
			throw new Error(`Expected formatter to mention discard PASS, got: ${output}`)
		}
		if (!output.includes("Owner-safe default workspace: PASS")) {
			throw new Error(`Expected formatter to mention owner-safe default workspace PASS, got: ${output}`)
		}
	})

	await runTest("verify:vscode:shell launcher: primes env and request-file smoke triggers", () => {
		const resultPath = "D:\\tmp\\swarm-shell-smoke-result.json"
		const requestPath = path.join(
			ROOT,
			"verification",
			`.tmp-vscode-shell-request-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
		)

		try {
			const env = buildVscodeShellSmokeEnv(
				{
					EXISTING_FLAG: "1",
					ELECTRON_RUN_AS_NODE: "1",
					VSCODE_IPC_HOOK: "\\\\.\\pipe\\example",
				},
				resultPath,
			)
			if (env["EXISTING_FLAG"] !== "1") throw new Error("Expected base environment entries to be preserved")
			if (env["ELECTRON_RUN_AS_NODE"]) throw new Error("Expected ELECTRON_RUN_AS_NODE to be stripped from smoke launch env")
			if (env["VSCODE_IPC_HOOK"]) throw new Error("Expected VSCODE_* variables to be stripped from smoke launch env")
			if (env["SWARM_VSCODE_SHELL_SMOKE"] !== "1") {
				throw new Error(`Expected SWARM_VSCODE_SHELL_SMOKE=1, got: ${String(env["SWARM_VSCODE_SHELL_SMOKE"])}`)
			}
			if (env["SWARM_VSCODE_SHELL_SMOKE_RESULT"] !== resultPath) {
				throw new Error(
					`Expected SWARM_VSCODE_SHELL_SMOKE_RESULT=${resultPath}, got: ${String(env["SWARM_VSCODE_SHELL_SMOKE_RESULT"])}`,
				)
			}

			writeVscodeShellSmokeRequest(requestPath, resultPath)
			const written = JSON.parse(fs.readFileSync(requestPath, "utf8")) as { resultPath?: string }
			if (written.resultPath !== resultPath) {
				throw new Error(`Expected smoke request resultPath=${resultPath}, got: ${String(written.resultPath)}`)
			}
		} finally {
			if (fs.existsSync(requestPath)) fs.unlinkSync(requestPath)
		}
	})

	await runTest("MergerAgent wiring: sends worker_done after merge attempt", async () => {
		DatabaseService.reset()
		const dbPath = path.join(ROOT, "verification", ".tmp-merger-test.db")
		const db = DatabaseService.getInstance(dbPath)
		const stub = new StubModelClient(["reviewer_pass"])

		WorkspaceLock.setRoot(TEST_WORKSPACE)
		const agent = new MergerAgent("merger-test-1", "task-test-1", "merge branches", TEST_WORKSPACE, [], db, stub)
		await agent.runAutonomousLoop()

		const msg = db.get("SELECT * FROM messages WHERE from_agent='merger-test-1' AND type='worker_done'")

		db.close()
		DatabaseService.reset()
		if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

		if (!msg) throw new Error("MergerAgent did not send worker_done message â€” wiring broken")
	})

	await runTest("CLI dry-run: exits without crashing and reports a truthful terminal status", () => {
		const swarmDistJs = path.join(ROOT, "dist", "swarm.js")
		const swarmTs = path.join(ROOT, "swarm.ts")
		const entry = fs.existsSync(swarmDistJs) ? swarmDistJs : swarmTs

		const isJs = entry.endsWith(".js")
		const cmd = isJs ? process.execPath : "npx"
		const args = isJs
			? [entry, "--task", "add a brief comment to hello.ts", "--workspace", TEST_WORKSPACE, "--dryRun"]
			: ["tsx", entry, "--task", "add a brief comment to hello.ts", "--workspace", TEST_WORKSPACE, "--dryRun"]

		return runCommandCapture(cmd, args, { cwd: ROOT, timeoutMs: 15_000 }).then(({ stdout, stderr, code }) => {
			const output = `${stdout}\n${stderr}`
			if (code !== 0 && code !== 2) throw new Error(`CLI dry-run exited unexpectedly: ${code ?? "null"}\n${output.trim()}`)
			if (!output.includes("DRY RUN")) throw new Error("CLI dry-run output missing DRY RUN marker")
			if (!output.includes("[Swarm] Final status:")) {
				throw new Error(`CLI dry-run output missing final status marker:\n${output.trim()}`)
			}
		})
	})

	// Summary
	console.log("\n===================================")
	const passed = results.filter((r) => r.passed).length
	const failed = results.filter((r) => !r.passed).length
	console.log(`  Level 1: ${failed === 0 ? "PASS" : "FAIL"} - ${passed}/${results.length} tests passed`)
	console.log("===================================\n")

	if (failed > 0) process.exit(1)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
