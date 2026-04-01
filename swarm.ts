#!/usr/bin/env node
import minimist from "minimist"
import path from "path"
import fs from "fs"
import { formatQueenshiftCommand } from "./src/cli/CommandSurface"
import {
	QUEENSHIFT_EXIT_ACTION_REQUIRED,
	QUEENSHIFT_EXIT_FAILURE,
	QUEENSHIFT_EXIT_SUCCESS,
} from "./src/cli/ExitCodes"
import { formatQueenshiftDoctorReport, formatQueenshiftHelp, formatQueenshiftVersion, resolveQueenshiftVersion } from "./src/cli/ProductSurface"
import { buildRuntimeVisibilitySnapshot, formatRuntimeVisibilityBlock } from "./src/cli/RuntimeVisibility"
import { WorkspaceLock } from "./src/safety/WorkspaceLock"
import { formatEngineSelection, resolveEngineSelection } from "./src/engine/EngineSelection"
import { runSelectedTaskEngine } from "./src/engine/EngineRuntime"
import { evaluateAdmission, evaluateTaskAdmission, formatAdmissionReport } from "./src/run/AdmissionGate"
import {
	approveReviewRun,
	discardReviewRun,
	ensureReviewPack,
	formatReviewPack,
	formatReviewQueueList,
	listPendingReviewItems,
} from "./src/run/ReviewQueue"
import {
	formatIncidentExport,
	resolveIncidentExport,
	rollbackIncidentRun,
} from "./src/run/IncidentPack"
import { readRunSummary } from "./src/run/RunArtifacts"
import { formatReplayExport, resolveReplayExport } from "./src/run/ReplayExport"
import { formatResumeCandidate, resolveResumeCandidate } from "./src/run/Resume"
import { formatDailyDriverStatus, recordDailyDriverFromSummaryPath, resolveRc1RootDir } from "./src/release/Rc1Ops"
import { formatDemoRepoPackResult, formatDemoRepoResetResult, resetDemoRepoPack, runDemoRepoPack } from "./src/owner/DemoRepoPack"
import { buildDemoGallery, formatDemoGallery } from "./src/owner/DemoGallery"
import { buildRepoMapArtifact, formatRepoMapArtifact } from "./src/planning/RepoMap"
import {
	buildOwnerLifeSignal,
	buildOwnerQuickActions,
	formatOwnerLifeSignal,
	formatOwnerQuickActions,
} from "./src/owner/OwnerFollowUp"
import {
	buildOwnerProviderDiagnostic,
	formatOwnerProviderDiagnostic,
	formatOwnerProviderSelection,
	resolveOwnerProviderSelection,
} from "./src/owner/ProviderResolution"
import { formatOwnerBetaResult, runOwnerBeta } from "./src/owner/OwnerBeta"
import { formatOwnerGuidedDemoResult, runOwnerGuidedDemo } from "./src/owner/OwnerGuidedDemo"
import { formatRepoOnboardResult, runRepoOnboard } from "./src/owner/RepoOnboard"
import { readOwnerRc1Snapshot } from "./src/owner/OwnerStatus"
import { formatOwnerCacheResetResult, formatOwnerCacheStatus, resetOwnerCache } from "./src/owner/OwnerCache"
import { buildTaskCorpusReport, formatTaskCorpusReport } from "./src/owner/TaskCorpus"
import {
	formatPatternMemoryArtifact,
	readPatternMemoryArtifact,
	resetPatternMemoryArtifact,
} from "./src/planning/PatternMemory"
import { buildWorkspaceMemoryOverview, formatWorkspaceMemoryOverview } from "./src/planning/WorkspaceMemory"
import {
	formatSupportedExecutorAdapters,
	formatSupportedExecutorAdapterContracts,
	formatSupportedPolicyPacks,
	formatSupportedVerificationProfileClasses,
	listSupportedExecutorAdapterContracts,
	listSupportedExecutorAdapters,
	listSupportedPolicyPacks,
	listSupportedVerificationProfileClasses,
} from "./src/run/VerificationProfileCatalog"
import {
	buildHeadToHeadBenchmarkReport,
	formatHeadToHeadBenchmarkReport,
} from "./src/benchmark/HeadToHeadBenchmark"
import {
	approveQueuedWorkItem,
	buildWorkQueueSummary,
	cancelQueuedWorkItem,
	enqueueWorkItem,
	findNextReadyQueuedWorkItem,
	formatWorkQueueArtifact,
	formatWorkQueueSummary,
	readWorkQueueArtifact,
} from "./src/run/WorkQueue"

const KNOWN_COMMANDS = new Set([
	"help",
	"version",
	"profiles:list",
	"profiles:adapters",
	"profiles:adapter-contracts",
	"profiles:policy-packs",
	"owner:status",
	"owner:provider:diagnose",
	"doctor",
	"owner:guided:demo",
	"owner:life-signal",
	"owner:quick-actions",
	"owner:cache:show",
	"owner:cache:reset",
	"demo:reset",
	"demo:run",
	"demo:gallery",
	"benchmark:head-to-head",
	"task-corpus:report",
	"repo:onboard",
	"memory:show",
	"memory:reset",
	"queue:list",
	"queue:next",
	"queue:add",
	"queue:approve",
	"queue:cancel",
	"review:list",
	"review:show",
	"review:approve",
	"review:discard",
	"incident:latest",
	"incident:show",
	"incident:rollback",
	"resume:show",
	"resume:latest",
	"replay:show",
	"replay:latest",
	"repo:map",
])

function asTrimmedCliString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function asPositionalCliArgs(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
				.map((entry) => entry.trim())
		: []
}

function resolveCliIntent(args: ReturnType<typeof minimist>): { command: string; task: string | undefined } {
	const explicitTask = asTrimmedCliString(args.task)
	const positionals = asPositionalCliArgs(args._)
	const firstPositional = positionals[0] ?? ""
	const knownCommand = KNOWN_COMMANDS.has(firstPositional)

	if (explicitTask) {
		return {
			command: knownCommand ? firstPositional : "",
			task: explicitTask,
		}
	}

	if (knownCommand) {
		return {
			command: firstPositional,
			task: undefined,
		}
	}

	if (positionals.length > 1 || /\s/u.test(firstPositional)) {
		return {
			command: "",
			task: positionals.join(" "),
		}
	}

	return {
		command: firstPositional,
		task: undefined,
	}
}

async function main() {
	const args = minimist(process.argv.slice(2))
	const { command, task } = resolveCliIntent(args)

	const workspace = args.workspace as string | undefined
	const dryRun = args.dryRun === true || args.dryRun === "true"
	const allowDirty = args.allowDirty === true || args.allowDirty === "true"
	const admitOnly = args.admitOnly === true || args.admitOnly === "true"
	const providerArg = (args.provider as string | undefined) ?? undefined
	const modelArg = (args.model as string | undefined) ?? undefined
	const jsonOutput = args.json === true || args.json === "true"
	const helpRequested = args.help === true || args.h === true || command === "help"
	const versionRequested = args.version === true || command === "version"

	if (providerArg && providerArg.trim()) process.env["SWARM_PROVIDER"] = providerArg.trim()
	if (modelArg && modelArg.trim()) process.env["SWARM_MODEL"] = modelArg.trim()

	if (versionRequested) {
		if (jsonOutput) {
			console.log(
				JSON.stringify(
					{
						product: "Queenshift CLI",
						version: resolveQueenshiftVersion(__dirname),
						command: "queenshift",
						defaultEngine: "swarmengine",
						experimentalEngine: "queenbee",
					},
					null,
					2,
				),
			)
		} else {
			console.log(formatQueenshiftVersion(__dirname))
		}
		process.exit(QUEENSHIFT_EXIT_SUCCESS)
	}

	if (helpRequested || (!command && !task)) {
		console.log(formatQueenshiftHelp(__dirname))
		process.exit(QUEENSHIFT_EXIT_SUCCESS)
	}

	if (command && !KNOWN_COMMANDS.has(command) && !task) {
		console.error(
			`ERROR: unknown command: ${command}. For a direct bounded task, use ${formatQueenshiftCommand(["add a brief comment to hello.ts", "--workspace", "D:\\SwarmSandbox\\test-repo"])}`,
		)
		process.exit(QUEENSHIFT_EXIT_FAILURE)
	}

	if (!workspace) {
		if (
			command !== "owner:status" &&
			command !== "owner:provider:diagnose" &&
			command !== "owner:guided:demo" &&
			command !== "owner:cache:show" &&
			command !== "owner:cache:reset" &&
			command !== "profiles:list" &&
			command !== "profiles:adapters" &&
			command !== "profiles:adapter-contracts" &&
			command !== "profiles:policy-packs" &&
			command !== "demo:run" &&
			command !== "demo:reset" &&
			command !== "demo:gallery" &&
			command !== "benchmark:head-to-head" &&
			command !== "task-corpus:report" &&
			command !== "doctor"
		) {
			console.error(
				`ERROR: --workspace is required. Example: ${formatQueenshiftCommand(["--task", "add a brief comment to hello.ts", "--workspace", "D:\\SwarmSandbox\\test-repo"])}`,
			)
			process.exit(QUEENSHIFT_EXIT_FAILURE)
		}
	}

	const resolvedWorkspace = workspace ? path.resolve(workspace) : ""
	if (workspace && !fs.existsSync(resolvedWorkspace)) {
		console.error(`ERROR: workspace does not exist: ${resolvedWorkspace}`)
		process.exit(QUEENSHIFT_EXIT_FAILURE)
	}

	if (command === "profiles:list") {
		const profiles = listSupportedVerificationProfileClasses()
		console.log(jsonOutput ? JSON.stringify(profiles, null, 2) : formatSupportedVerificationProfileClasses())
		process.exit(0)
	}

	if (command === "profiles:adapters") {
		const adapters = listSupportedExecutorAdapters()
		console.log(jsonOutput ? JSON.stringify(adapters, null, 2) : formatSupportedExecutorAdapters())
		process.exit(0)
	}

	if (command === "profiles:adapter-contracts") {
		const contracts = listSupportedExecutorAdapterContracts()
		console.log(jsonOutput ? JSON.stringify(contracts, null, 2) : formatSupportedExecutorAdapterContracts())
		process.exit(0)
	}

	if (command === "profiles:policy-packs") {
		const policyPacks = listSupportedPolicyPacks()
		console.log(jsonOutput ? JSON.stringify(policyPacks, null, 2) : formatSupportedPolicyPacks())
		process.exit(0)
	}

	if (command === "owner:status") {
		const rc1RootDir = resolveRc1RootDir(__dirname)
		const providerSelection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
		const rc1Snapshot = readOwnerRc1Snapshot(rc1RootDir)
		const beta = await runOwnerBeta(rc1RootDir, process.env as Record<string, string | undefined>)
		const output = [
			formatOwnerProviderSelection(providerSelection),
			"",
			formatDailyDriverStatus(rc1Snapshot.status),
			"",
			formatOwnerBetaResult(beta),
		].join("\n")
		console.log(output)
		process.exit(beta.ready ? QUEENSHIFT_EXIT_SUCCESS : QUEENSHIFT_EXIT_FAILURE)
	}

	if (command === "owner:provider:diagnose") {
		try {
			const selection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
			const diagnostic = buildOwnerProviderDiagnostic(selection)
			console.log(jsonOutput ? JSON.stringify(diagnostic, null, 2) : formatOwnerProviderDiagnostic(diagnostic))
			process.exit(selection.ready ? QUEENSHIFT_EXIT_SUCCESS : QUEENSHIFT_EXIT_FAILURE)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(QUEENSHIFT_EXIT_FAILURE)
		}
	}

	if (command === "doctor") {
		try {
			const selection = resolveOwnerProviderSelection(process.env as Record<string, string | undefined>)
			const diagnostic = buildOwnerProviderDiagnostic(selection)
			console.log(
				jsonOutput
					? JSON.stringify(
							{
								product: "Queenshift",
								command: "queenshift doctor",
								version: resolveQueenshiftVersion(__dirname),
								diagnostic,
							},
							null,
							2,
					  )
					: formatQueenshiftDoctorReport(diagnostic, __dirname),
			)
			process.exit(selection.ready ? QUEENSHIFT_EXIT_SUCCESS : QUEENSHIFT_EXIT_FAILURE)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(QUEENSHIFT_EXIT_FAILURE)
		}
	}

	if (command === "owner:guided:demo") {
		try {
			const result = await runOwnerGuidedDemo(resolveRc1RootDir(__dirname), process.env as Record<string, string | undefined>)
			console.log(formatOwnerGuidedDemoResult(result, { debug: args.debug === true || args.debug === "true" }))
			process.exit(result.passed ? 0 : 1)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "owner:life-signal") {
		try {
			const result = buildOwnerLifeSignal(resolvedWorkspace, {
				preferredRunId: (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined),
			})
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatOwnerLifeSignal(result))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "owner:quick-actions") {
		try {
			const result = buildOwnerQuickActions(resolvedWorkspace, {
				preferredRunId: (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined),
			})
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatOwnerQuickActions(result))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "owner:cache:show") {
		try {
			console.log(formatOwnerCacheStatus(resolveRc1RootDir(__dirname)))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "owner:cache:reset") {
		try {
			const result = resetOwnerCache(resolveRc1RootDir(__dirname))
			console.log(formatOwnerCacheResetResult(result))
			process.exit(result.removed ? 0 : 1)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "demo:reset") {
		try {
			const result = await resetDemoRepoPack(resolveRc1RootDir(__dirname))
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatDemoRepoResetResult(result))
			process.exit(result.passed ? 0 : 1)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "demo:run") {
		try {
			const result = await runDemoRepoPack(resolveRc1RootDir(__dirname), process.env as Record<string, string | undefined>)
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatDemoRepoPackResult(result, { debug: args.debug === true || args.debug === "true" }))
			process.exit(result.passed ? 0 : 1)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "demo:gallery") {
		try {
			const gallery = buildDemoGallery(resolveRc1RootDir(__dirname))
			console.log(jsonOutput ? JSON.stringify(gallery, null, 2) : formatDemoGallery(gallery))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "benchmark:head-to-head") {
		try {
			const rootDir = resolveRc1RootDir(__dirname)
			const report = buildHeadToHeadBenchmarkReport(rootDir, typeof args.study === "string" ? args.study : undefined)
			console.log(jsonOutput ? JSON.stringify(report, null, 2) : formatHeadToHeadBenchmarkReport(report))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "task-corpus:report") {
		try {
			const rootDir = resolveRc1RootDir(__dirname)
			const report = buildTaskCorpusReport(rootDir)
			console.log(jsonOutput ? JSON.stringify(report, null, 2) : formatTaskCorpusReport(report))
			process.exit(report.catalogValidationIssues.length === 0 ? 0 : 1)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "repo:onboard") {
		try {
			const result = await runRepoOnboard(resolvedWorkspace, {
				scaffoldProfile: args.scaffoldProfile === true || args.scaffoldProfile === "true",
				scaffoldKnowledgePack: args.scaffoldKnowledgePack === true || args.scaffoldKnowledgePack === "true",
			})
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatRepoOnboardResult(result))
			process.exit(result.readiness.decision === "refuse" ? 2 : 0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "memory:show") {
		try {
			const overview = buildWorkspaceMemoryOverview(resolvedWorkspace, {
				rootDir: resolveRc1RootDir(__dirname),
			})
			const activeLayers = overview.layers.filter((layer) => layer.state === "active").length
			console.log(jsonOutput ? JSON.stringify(overview, null, 2) : formatWorkspaceMemoryOverview(overview))
			process.exit(activeLayers > 0 ? 0 : 2)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "memory:reset") {
		try {
			const removed = resetPatternMemoryArtifact(resolvedWorkspace)
			console.log(removed ? "Pattern memory reset." : "Pattern memory was already empty.")
			process.exit(removed ? 0 : 2)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command.startsWith("queue:")) {
		try {
			switch (command) {
				case "queue:list": {
					const artifact = readWorkQueueArtifact(resolvedWorkspace)
					console.log(jsonOutput ? JSON.stringify(artifact, null, 2) : formatWorkQueueArtifact(artifact))
					process.exit(artifact.items.length > 0 ? 0 : 2)
				}
				case "queue:next": {
					const nextItem = findNextReadyQueuedWorkItem(resolvedWorkspace)
					if (!nextItem) {
						const summary = buildWorkQueueSummary(resolvedWorkspace)
						console.log(jsonOutput ? JSON.stringify(summary, null, 2) : formatWorkQueueSummary(summary))
						process.exit(2)
					}
					console.log(jsonOutput ? JSON.stringify(nextItem, null, 2) : `${nextItem.queueId}: ${nextItem.task}`)
					process.exit(0)
				}
				case "queue:add": {
					if (!task) {
						console.error(
							`ERROR: queue:add requires --task. Example: ${formatQueenshiftCommand(["queue:add", "--task", "add a comment to hello.ts", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const taskAdmission = evaluateTaskAdmission(task, resolvedWorkspace)
					if (taskAdmission.decision === "refuse") {
						console.error(`ERROR: queued task is outside the proven lane.\n${taskAdmission.details.join("\n")}`)
						process.exit(1)
					}
					const result = enqueueWorkItem(resolvedWorkspace, {
						task,
						scheduledAt: typeof args.scheduleAt === "string" ? args.scheduleAt : null,
						note: typeof args.note === "string" ? args.note : null,
						campaignId: typeof args.campaignId === "string" ? args.campaignId : null,
						originRunId: typeof args.originRunId === "string" ? args.originRunId : null,
						taskContract: taskAdmission.derivedTaskContract,
						executionMode: args.backgroundCandidate === true || args.backgroundCandidate === "true" ? "background_candidate" : "manual",
					})
					console.log(
						jsonOutput
							? JSON.stringify(result, null, 2)
							: `Queued ${result.item.queueId}${result.item.scheduledAt ? ` for ${result.item.scheduledAt}` : ""}${result.item.executionMode === "background_candidate" ? " [background candidate]" : ""}: ${result.item.task}`,
					)
					process.exit(0)
				}
				case "queue:approve": {
					const queueId = typeof args._[1] === "string" ? String(args._[1]) : ""
					if (!queueId.trim()) {
						console.error(
							`ERROR: queue:approve requires a queue id. Example: ${formatQueenshiftCommand(["queue:approve", "queue-123", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const result = approveQueuedWorkItem(resolvedWorkspace, queueId.trim(), {
						approvedBy:
							(typeof args.approvedBy === "string" ? args.approvedBy : null) ??
							process.env["USERNAME"] ??
							process.env["USER"] ??
							null,
					})
					if (!result.found) {
						console.error(`ERROR: no queued work item found for ${queueId.trim()}`)
						process.exit(1)
					}
					if (!result.approved) {
						console.error(`ERROR: ${queueId.trim()} is not waiting on owner approval.`)
						process.exit(1)
					}
					console.log(
						jsonOutput
							? JSON.stringify(result, null, 2)
							: `Approved background candidate ${queueId.trim()}${result.item?.approvedBy ? ` by ${result.item.approvedBy}` : ""}.`,
					)
					process.exit(0)
				}
				case "queue:cancel": {
					const queueId =
						(typeof args.queueId === "string" ? args.queueId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined)
					if (!queueId) {
						console.error(
							`ERROR: queue:cancel requires a queue id. Example: ${formatQueenshiftCommand(["queue:cancel", "queue-123abc", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const result = cancelQueuedWorkItem(resolvedWorkspace, queueId)
					console.log(
						jsonOutput
							? JSON.stringify(result, null, 2)
							: result.found
								? result.cancelled
									? `Cancelled ${queueId}.`
									: `${queueId} was already ${result.item?.status ?? "resolved"}.`
								: `Queue item not found: ${queueId}`,
					)
					process.exit(result.cancelled ? 0 : result.found ? 2 : 1)
				}
				default:
					console.error(`ERROR: unknown queue command: ${command}`)
					process.exit(1)
			}
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command.startsWith("review:")) {
		const gitDir = path.join(resolvedWorkspace, ".git")
		if (!fs.existsSync(gitDir)) {
			console.error(`ERROR: workspace is not a git repository: ${resolvedWorkspace}`)
			console.error("Run: git init in that folder first.")
			process.exit(1)
		}
		const runId = (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined)
		try {
			switch (command) {
				case "review:list": {
					const items = listPendingReviewItems(resolvedWorkspace)
					console.log(jsonOutput ? JSON.stringify(items, null, 2) : formatReviewQueueList(items))
					process.exit(0)
				}
				case "review:show": {
					if (!runId) {
						console.error(
							`ERROR: review:show requires a run id. Example: ${formatQueenshiftCommand(["review:show", "task-123abc", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const pack = await ensureReviewPack(resolvedWorkspace, runId)
					console.log(jsonOutput ? JSON.stringify(pack, null, 2) : formatReviewPack(pack))
					process.exit(0)
				}
				case "review:approve": {
					if (!runId) {
						console.error(
							`ERROR: review:approve requires a run id. Example: ${formatQueenshiftCommand(["review:approve", "task-123abc", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const result = await approveReviewRun(resolvedWorkspace, runId, {
						reviewerId: typeof args.reviewer === "string" ? args.reviewer : undefined,
					})
					console.log(jsonOutput ? JSON.stringify(result, null, 2) : result.message)
					process.exit(0)
				}
				case "review:discard": {
					if (!runId) {
						console.error(
							`ERROR: review:discard requires a run id. Example: ${formatQueenshiftCommand(["review:discard", "task-123abc", "--workspace", "<repo>"])}`,
						)
						process.exit(1)
					}
					const result = await discardReviewRun(resolvedWorkspace, runId)
					console.log(jsonOutput ? JSON.stringify(result, null, 2) : result.message)
					process.exit(0)
				}
				default:
					console.error(`ERROR: unknown review command: ${command}`)
					process.exit(1)
			}
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command.startsWith("incident:")) {
		const gitDir = path.join(resolvedWorkspace, ".git")
		if (!fs.existsSync(gitDir)) {
			console.error(`ERROR: workspace is not a git repository: ${resolvedWorkspace}`)
			console.error("Run: git init in that folder first.")
			process.exit(QUEENSHIFT_EXIT_FAILURE)
		}
		const requestedRunId = (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined)
		try {
			switch (command) {
				case "incident:latest":
				case "incident:show": {
					const result = await resolveIncidentExport(
						resolvedWorkspace,
						command === "incident:latest" ? "latest" : (requestedRunId ?? "latest"),
					)
					console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatIncidentExport(result))
					process.exit(result.found ? QUEENSHIFT_EXIT_SUCCESS : QUEENSHIFT_EXIT_ACTION_REQUIRED)
				}
				case "incident:rollback": {
					const incidentLookup = await resolveIncidentExport(resolvedWorkspace, requestedRunId ?? "latest")
					if (!incidentLookup.found || !incidentLookup.runId) {
						console.log(jsonOutput ? JSON.stringify(incidentLookup, null, 2) : formatIncidentExport(incidentLookup))
						process.exit(QUEENSHIFT_EXIT_ACTION_REQUIRED)
					}
					const result = await rollbackIncidentRun(resolvedWorkspace, incidentLookup.runId)
					console.log(jsonOutput ? JSON.stringify(result, null, 2) : result.message)
					process.exit(result.decision === "refused" ? QUEENSHIFT_EXIT_ACTION_REQUIRED : QUEENSHIFT_EXIT_SUCCESS)
				}
				default:
					console.error(`ERROR: unknown incident command: ${command}`)
					process.exit(QUEENSHIFT_EXIT_FAILURE)
			}
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(QUEENSHIFT_EXIT_FAILURE)
		}
	}

	if (command === "resume:show" || command === "resume:latest") {
		const requestedRunId = (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined)
		try {
			const candidate = await resolveResumeCandidate(resolvedWorkspace, {
				runId: command === "resume:latest" ? "latest" : requestedRunId,
				allowManifestDrift: args.allowManifestDrift === true || args.allowManifestDrift === "true",
				env: process.env as Record<string, string | undefined>,
			})
			console.log(jsonOutput ? JSON.stringify(candidate, null, 2) : formatResumeCandidate(candidate))
			process.exit(candidate.resumable ? 0 : 2)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "replay:show" || command === "replay:latest") {
		const requestedRunId = (typeof args.runId === "string" ? args.runId : undefined) ?? (typeof args._[1] === "string" ? String(args._[1]) : undefined)
		try {
			const result = resolveReplayExport(resolvedWorkspace, command === "replay:latest" ? "latest" : (requestedRunId ?? ""))
			console.log(jsonOutput ? JSON.stringify(result, null, 2) : formatReplayExport(result))
			process.exit(result.found ? 0 : 2)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (command === "repo:map") {
		try {
			const repoMap = await buildRepoMapArtifact(resolvedWorkspace)
			console.log(jsonOutput ? JSON.stringify(repoMap, null, 2) : formatRepoMapArtifact(repoMap))
			process.exit(0)
		} catch (err) {
			console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
			process.exit(1)
		}
	}

	if (!task) {
		console.error(
			`ERROR: --task is required. Example: ${formatQueenshiftCommand(["--task", "add a console.log to hello.ts", "--workspace", "D:\\SwarmSandbox\\test-repo"])}`,
		)
		process.exit(QUEENSHIFT_EXIT_FAILURE)
	}

	let engineSelection
	try {
		engineSelection = resolveEngineSelection(args.engine)
	} catch (err) {
		console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
		process.exit(QUEENSHIFT_EXIT_FAILURE)
	}

	const admission = await evaluateAdmission({
		workspace: resolvedWorkspace,
		task,
		allowDirty,
	})

	if (admitOnly) {
		console.log(jsonOutput ? JSON.stringify(admission, null, 2) : formatAdmissionReport(admission))
		process.exit(admission.decision === "refuse" ? QUEENSHIFT_EXIT_ACTION_REQUIRED : QUEENSHIFT_EXIT_SUCCESS)
	}

	if (admission.decision === "refuse") {
		if (jsonOutput) console.log(JSON.stringify(admission, null, 2))
		else console.error(formatAdmissionReport(admission))
		process.exit(QUEENSHIFT_EXIT_ACTION_REQUIRED)
	}

	WorkspaceLock.setRoot(resolvedWorkspace)
	console.log(`[Swarm] Workspace locked to: ${resolvedWorkspace}`)
	if (admission.decision === "allow_with_review_bias") {
		console.log("[Swarm] Admission: ALLOW WITH REVIEW BIAS")
		for (const reason of admission.reasonCodes) {
			console.log(`[Swarm] Admission reason: ${reason}`)
		}
	}
	console.log(formatEngineSelection(engineSelection))

	if (dryRun) {
		console.log("[Swarm] Mode: DRY RUN (stub model, no files written)")
	} else {
		const provider = process.env["SWARM_PROVIDER"] ?? "openai"
		const model = process.env["SWARM_MODEL"] ?? "(default)"
		console.log(`[Swarm] Mode: LIVE (provider: ${provider}, model: ${model})`)
		if (allowDirty) {
			console.log("[Swarm] Safety override: --allowDirty enabled")
		}
	}

	console.log(`[Swarm] Task: "${task}"`)

	let exitCode = QUEENSHIFT_EXIT_SUCCESS
	const result = await runSelectedTaskEngine(engineSelection, {
		engine: engineSelection.engine,
		workspace: resolvedWorkspace,
		dryRun,
		allowDirty,
		task,
		taskContract: admission.task.derivedTaskContract,
	})
	const rc1RootDir = resolveRc1RootDir(__dirname)

	if (result.summaryPath) {
		const summary = readRunSummary(path.dirname(result.summaryPath))
		const runtimeVisibility = buildRuntimeVisibilitySnapshot(summary, resolvedWorkspace, result.status, result.summaryPath)
		for (const line of formatRuntimeVisibilityBlock(runtimeVisibility).split(/\r?\n/g)) {
			if (line.trim()) console.log(`[Swarm] ${line}`)
		}
		try {
			const autoCredit = recordDailyDriverFromSummaryPath(rc1RootDir, result.summaryPath)
			if (autoCredit.decision === "skipped") {
				if (!autoCredit.reason.includes("Verification fixture workspace is excluded")) {
					console.warn(`[RC1] Auto-credit skipped: ${autoCredit.reason}`)
				}
			} else {
				console.log(`[RC1] Daily-driver auto-record: ${autoCredit.decision.toUpperCase()} (${autoCredit.reason})`)
				console.log(formatDailyDriverStatus(autoCredit.status))
			}
		} catch (err) {
			console.warn(`[RC1] Auto-credit warning: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	console.log(`[Swarm] Final status: ${result.status}`)
	if (result.message) {
		for (const line of result.message.split(/\r?\n/g)) {
			if (line.trim()) console.log(`[Swarm] ${line}`)
		}
	}

	if (result.status === "done") {
		console.log("[Swarm] Done.")
		exitCode = QUEENSHIFT_EXIT_SUCCESS
	} else if (result.status === "review_required") {
		console.log("[Swarm] Review required before this run can be accepted.")
		exitCode = QUEENSHIFT_EXIT_ACTION_REQUIRED
	} else if (result.status === "candidate_not_ready") {
		console.error("[Swarm] Engine not ready.")
		exitCode = QUEENSHIFT_EXIT_FAILURE
	} else {
		console.error("[Swarm] Run failed.")
		exitCode = QUEENSHIFT_EXIT_FAILURE
	}

	process.exit(exitCode)
}

main().catch((err) => {
	console.error("[Swarm] Fatal error:", err)
	process.exit(QUEENSHIFT_EXIT_FAILURE)
})
