import fs from "node:fs"
import path from "node:path"

import { buildRuntimeVisibilitySnapshot, formatRuntimeVisibilityBlock } from "../cli/RuntimeVisibility"
import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import { formatForensicsReport, type SummaryLike } from "../run/Forensics"
import { findLatestRunSummary } from "../run/RunArtifacts"

export type ShellLaunchSpec = {
	command: string
	args: string[]
	cwd: string
	displayCommand: string
	workspace: string
	cliEntry: string
	envOverrides?: Record<string, string>
}

export type ShellSnapshot = {
	summaryPath: string | null
	runtimeText: string
	summaryText: string
	forensicsText: string
}

export type ShellTaskLaunchOptions = {
	dryRun?: boolean
	extraArgs?: string[]
	extraDisplayArgs?: string[]
	envOverrides?: Record<string, string>
}

type CandidateProgressSnapshot = {
	engine?: string
	status?: string
	stopReason?: string
	taskFamilyHint?: string | null
	currentStage?: string
	activeQueue?: string
	selectedSpecialist?: string | null
	lastEventAt?: string | null
	nextTimeoutAt?: string | null
	missionId?: string | null
	assignmentId?: string | null
	confidenceOutcome?: string | null
	nextExpectedHandoff?: string | null
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function resolveCliEntry(repoRoot: string): string {
	const cliEntry = path.join(repoRoot, "dist", "swarm.js")
	if (!fs.existsSync(cliEntry)) {
		throw new Error(`Compiled CLI entry not found at ${cliEntry}. Run npm.cmd run build first.`)
	}
	return cliEntry
}

function buildShellCommandSpec(
	repoRoot: string,
	workspace: string,
	args: string[],
	displayArgs: string[],
	envOverrides: Record<string, string> = {},
): ShellLaunchSpec {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace) throw new Error("Workspace path is required before launching the CLI.")

	const resolvedRepoRoot = path.resolve(repoRoot)
	const resolvedWorkspace = path.resolve(normalizedWorkspace)
	const cliEntry = resolveCliEntry(resolvedRepoRoot)
	return {
		command: process.execPath,
		args: [cliEntry, ...args, "--workspace", resolvedWorkspace],
		cwd: resolvedRepoRoot,
		displayCommand: formatQueenshiftWorkspaceCommand(displayArgs, resolvedWorkspace),
		workspace: resolvedWorkspace,
		cliEntry,
		envOverrides,
	}
}

function formatSummaryText(summaryPath: string, rawSummary: string): string {
	try {
		const parsed = JSON.parse(rawSummary) as Record<string, unknown>
		return [`Artifact: ${summaryPath}`, "", JSON.stringify(parsed, null, 2)].join("\n")
	} catch {
		return [`Artifact: ${summaryPath}`, "", rawSummary.trim()].join("\n")
	}
}

function formatEmptyRuntimeText(message: string): string {
	return [
		"Runtime summary:",
		"Engine: (unknown)",
		"Path: (unknown)",
		`Visible progress: ${message}`,
		"Summary artifact: (missing)",
		"Next step: (none)",
	].join("\n")
}

function resolveCandidateProgressPath(workspace: string): string {
	return path.join(workspace, ".swarm", "queenbee-candidate", "latest-progress.json")
}

function readCandidateProgressSnapshot(workspace: string): { path: string; raw: string; parsed: CandidateProgressSnapshot | null } | null {
	const progressPath = resolveCandidateProgressPath(workspace)
	if (!fs.existsSync(progressPath)) return null
	const raw = fs.readFileSync(progressPath, "utf8")
	let parsed: CandidateProgressSnapshot | null = null
	try {
		parsed = JSON.parse(raw) as CandidateProgressSnapshot
	} catch {
		parsed = null
	}
	return {
		path: progressPath,
		raw,
		parsed,
	}
}

function formatCandidateProgressForensics(pathLabel: string, parsed: CandidateProgressSnapshot | null): string {
	if (!parsed) {
		return [`QueenBee candidate progress preview`, `Artifact: ${pathLabel}`, "Snapshot could not be parsed."].join("\n")
	}
	return [
		"QueenBee candidate progress preview",
		`Artifact: ${pathLabel}`,
		`Status: ${parsed.status ?? "candidate_not_ready"}`,
		`Headline: ${parsed.currentStage ?? "(unknown)"} in ${parsed.activeQueue ?? "(unknown queue)"}; next ${parsed.nextExpectedHandoff ?? "(unknown)"}`,
		`Stage: ${parsed.currentStage ?? "(unknown)"} (${parsed.activeQueue ?? "(unknown queue)"})`,
		`Mission: ${parsed.missionId ?? "(unknown)"}`,
		`Assignment: ${parsed.assignmentId ?? "not created yet"}`,
		`Selected specialist: ${parsed.selectedSpecialist ?? "not selected yet"}`,
		`Last event: ${parsed.lastEventAt ?? "(unknown)"}`,
		`Next timeout: ${parsed.nextTimeoutAt ?? "(none)"}`,
		`Confidence outcome: ${parsed.confidenceOutcome ?? "(unknown)"}`,
		`Next handoff: ${parsed.nextExpectedHandoff ?? "(unknown)"}`,
		`Stop reason: ${parsed.stopReason ?? "(unknown)"}`,
	].join("\n")
}

function formatCandidateRuntimeText(pathLabel: string, parsed: CandidateProgressSnapshot | null): string {
	if (!parsed) {
		return [
			"Runtime summary:",
			"Engine: queenbee",
			"Path: (candidate preview)",
			"Visible progress: candidate preview artifact could not be parsed",
			`Summary artifact: ${pathLabel}`,
			"Next step: (preview only)",
		].join("\n")
	}

	const visibleProgressParts = [
		parsed.currentStage ? `stage=${parsed.currentStage}` : null,
		parsed.activeQueue ? `queue=${parsed.activeQueue}` : null,
		parsed.selectedSpecialist ? `specialist=${parsed.selectedSpecialist}` : null,
		parsed.confidenceOutcome ? `confidence=${parsed.confidenceOutcome}` : null,
		parsed.nextExpectedHandoff ? `next_handoff=${parsed.nextExpectedHandoff}` : null,
	].filter((part): part is string => Boolean(part))

	return [
		"Runtime summary:",
		`Engine: ${parsed.engine ?? "queenbee"}`,
		`Path: ${parsed.taskFamilyHint ?? "(candidate preview)"}`,
		`Visible progress: ${visibleProgressParts.join(" | ") || "candidate preview recorded, but no live runtime summary is available yet"}`,
		...(parsed.selectedSpecialist ? [`Selected specialist: ${parsed.selectedSpecialist}`] : []),
		`Summary artifact: ${pathLabel}`,
		"Next step: (preview only)",
	].join("\n")
}

export function resolveShellRepoRoot(extensionPath: string): string {
	return path.resolve(extensionPath, "..")
}

export function buildShellLaunchSpec(
	repoRoot: string,
	task: string,
	workspace: string,
	options: ShellTaskLaunchOptions = {},
): ShellLaunchSpec {
	const normalizedTask = task.trim()
	if (!normalizedTask) throw new Error("Task is required before launching the CLI.")
	const args = [normalizedTask, ...(options.extraArgs ?? [])]
	const displayArgs = [normalizedTask, ...(options.extraDisplayArgs ?? options.extraArgs ?? [])]
	if (options.dryRun) {
		args.push("--dryRun")
		displayArgs.push("--dryRun")
	}
	return buildShellCommandSpec(repoRoot, workspace, args, displayArgs, options.envOverrides ?? {})
}

export function buildShellAdmissionSpec(repoRoot: string, task: string, workspace: string): ShellLaunchSpec {
	const normalizedTask = task.trim()
	if (!normalizedTask) throw new Error("Task is required before running admission preflight.")
	return buildShellCommandSpec(repoRoot, workspace, [normalizedTask, "--admitOnly"], [normalizedTask, "--admitOnly"])
}

export function buildShellReviewCommandSpec(
	repoRoot: string,
	action: "review:approve" | "review:discard",
	workspace: string,
	runId: string,
): ShellLaunchSpec {
	const normalizedRunId = runId.trim()
	if (!normalizedRunId) throw new Error(`Run id is required before launching ${action}.`)
	return buildShellCommandSpec(repoRoot, workspace, [action, normalizedRunId], [action, normalizedRunId])
}

export function buildShellIncidentCommandSpec(
	repoRoot: string,
	action: "incident:latest" | "incident:show" | "incident:rollback",
	workspace: string,
	runId?: string,
): ShellLaunchSpec {
	const normalizedRunId = runId?.trim() ?? ""
	if ((action === "incident:show" || action === "incident:rollback") && !normalizedRunId) {
		throw new Error(`Run id is required before launching ${action}.`)
	}

	if (action === "incident:latest") {
		return buildShellCommandSpec(repoRoot, workspace, [action], [action])
	}

	return buildShellCommandSpec(repoRoot, workspace, [action, normalizedRunId], [action, normalizedRunId])
}

export function readShellSnapshot(workspace: string): ShellSnapshot {
	const normalizedWorkspace = workspace.trim()
	if (!normalizedWorkspace) {
		return {
			summaryPath: null,
			runtimeText: formatEmptyRuntimeText("select a workspace to load the latest CLI runtime summary"),
			summaryText: "Select a workspace to load the latest summary artifact.",
			forensicsText: "Select a workspace to load forensics.",
		}
	}

	const resolvedWorkspace = path.resolve(normalizedWorkspace)
	const summaryPath = findLatestRunSummary(resolvedWorkspace)
	const candidateProgress = readCandidateProgressSnapshot(resolvedWorkspace)
	if (!summaryPath || !fs.existsSync(summaryPath)) {
		if (candidateProgress) {
			return {
				summaryPath: null,
				runtimeText: formatCandidateRuntimeText(candidateProgress.path, candidateProgress.parsed),
				summaryText: formatSummaryText(candidateProgress.path, candidateProgress.raw),
				forensicsText: formatCandidateProgressForensics(candidateProgress.path, candidateProgress.parsed),
			}
		}
		return {
			summaryPath: null,
			runtimeText: formatEmptyRuntimeText("no run artifacts found yet for this workspace"),
			summaryText: "No run summary found yet for this workspace.",
			forensicsText: formatForensicsReport(null, null),
		}
	}

	if (candidateProgress) {
		const summaryMtime = fs.statSync(summaryPath).mtimeMs
		const candidateMtime = fs.statSync(candidateProgress.path).mtimeMs
		if (candidateMtime > summaryMtime) {
			return {
				summaryPath: null,
				runtimeText: formatCandidateRuntimeText(candidateProgress.path, candidateProgress.parsed),
				summaryText: formatSummaryText(candidateProgress.path, candidateProgress.raw),
				forensicsText: formatCandidateProgressForensics(candidateProgress.path, candidateProgress.parsed),
			}
		}
	}

	const rawSummary = fs.readFileSync(summaryPath, "utf8")
	let parsedSummary: SummaryLike | null = null
	try {
		parsedSummary = JSON.parse(rawSummary) as SummaryLike
	} catch {
		parsedSummary = null
	}

	const runtimeSnapshot = buildRuntimeVisibilitySnapshot(
		parsedSummary,
		resolvedWorkspace,
		asTrimmedString(parsedSummary?.["status"]) ?? "",
		summaryPath,
	)

	return {
		summaryPath,
		runtimeText: formatRuntimeVisibilityBlock(runtimeSnapshot),
		summaryText: formatSummaryText(summaryPath, rawSummary),
		forensicsText: formatForensicsReport(summaryPath, parsedSummary),
	}
}
