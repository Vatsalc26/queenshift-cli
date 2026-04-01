import path from "node:path"
import fs from "node:fs"

import { CommandExecutionError, CommandGate } from "../safety/CommandGate"
import { WorkspaceLock } from "../safety/WorkspaceLock"
import {
	buildVerificationProfileManifestCore,
	computeVerificationProfileManifestHash,
	formatSupportedVerificationProfileClasses,
	formatSupportedPolicyPacks,
	getSupportedVerificationProfileClass,
	validateVerificationProfileClassCommand,
	validatePolicyPackProfileClass,
	type SupportedExecutorAdapterId,
	type SupportedPolicyPackId,
	type SupportedVerificationProfileClass,
} from "./VerificationProfileCatalog"
import { resolveRuntimeConfig, type RuntimeConfig } from "./RuntimeConfig"

export type RepoVerificationProfile = {
	name: string
	profileClass: SupportedVerificationProfileClass | null
	executorAdapterId: SupportedExecutorAdapterId | null
	policyPackId: SupportedPolicyPackId | null
	manifestHash: string | null
	command: string
	cwd: string
	timeoutMs: number
	fileScopeHint: string[]
	sourcePath: string
}

export type VerificationProfileLoadResult = {
	profile: RepoVerificationProfile | null
	sourcePath: string | null
	issue: string | null
}

export type VerificationApplicability =
	| "no_profile_declared"
	| "invalid_profile"
	| "non_code_task"
	| "no_changed_files"
	| "scope_hint_miss"
	| "applied"

export type VerificationStatus = "passed" | "failed" | "blocked" | "timed_out" | "not_applicable"

export type VerificationProfileResult = {
	status: VerificationStatus
	applied: boolean
	applicability: VerificationApplicability
	profileName: string | null
	profileClass: SupportedVerificationProfileClass | null
	executorAdapterId: SupportedExecutorAdapterId | null
	policyPackId: SupportedPolicyPackId | null
	manifestHash: string | null
	sourcePath: string | null
	command: string | null
	cwd: string | null
	timeoutMs: number | null
	fileScopeHint: string[]
	matchedChangedFiles: string[]
	message: string
	details: string[]
	stdout: string
	stderr: string
	exitCode: number | null
}

type RawVerificationProfileConfig = {
	policyPack?: {
		packId?: unknown
	}
	verificationProfile?: {
		name?: unknown
		profileClass?: unknown
		manifestHash?: unknown
		command?: unknown
		cwd?: unknown
		timeoutMs?: unknown
		fileScopeHint?: unknown
	}
}

const PROFILE_CONFIG_FILENAME = ".swarmcoder.json"

function normalizeRelPath(value: string): string {
	return value.replace(/[\\/]+/g, "/").replace(/^\.\/+/u, "").trim()
}

function normalizeHintEntries(raw: unknown): string[] | null {
	if (typeof raw === "undefined") return []
	if (!Array.isArray(raw)) return null
	const values = raw
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => normalizeRelPath(entry))
		.filter(Boolean)
	return Array.from(new Set(values))
}

function formatProfileIssue(sourcePath: string, message: string): string {
	return `Verification profile config is invalid at ${sourcePath}: ${message}`
}

function buildNotApplicableResult(
	loadResult: VerificationProfileLoadResult,
	applicability: Exclude<VerificationApplicability, "applied">,
	message: string,
	details: string[],
): VerificationProfileResult {
	return {
		status: "not_applicable",
		applied: false,
		applicability,
		profileName: loadResult.profile?.name ?? null,
		profileClass: loadResult.profile?.profileClass ?? null,
		executorAdapterId: loadResult.profile?.executorAdapterId ?? null,
		policyPackId: loadResult.profile?.policyPackId ?? null,
		manifestHash: loadResult.profile?.manifestHash ?? null,
		sourcePath: loadResult.sourcePath,
		command: loadResult.profile?.command ?? null,
		cwd: loadResult.profile ? loadResult.profile.cwd : null,
		timeoutMs: loadResult.profile?.timeoutMs ?? null,
		fileScopeHint: loadResult.profile?.fileScopeHint ?? [],
		matchedChangedFiles: [],
		message,
		details,
		stdout: "",
		stderr: "",
		exitCode: null,
	}
}

function matchesFileScopeHint(changedFile: string, hint: string): boolean {
	const normalizedFile = normalizeRelPath(changedFile)
	const normalizedHint = normalizeRelPath(hint)
	if (!normalizedFile || !normalizedHint) return false
	if (normalizedHint.endsWith("/")) return normalizedFile.startsWith(normalizedHint)
	return normalizedFile === normalizedHint
}

export function loadRepoVerificationProfile(
	workspace: string,
	options: { runtimeConfig?: RuntimeConfig } = {},
): VerificationProfileLoadResult {
	const runtimeConfig = options.runtimeConfig ?? resolveRuntimeConfig(process.env)
	const sourcePath = path.join(workspace, PROFILE_CONFIG_FILENAME)
	if (!fs.existsSync(sourcePath)) {
		return { profile: null, sourcePath: null, issue: null }
	}

	let parsed: RawVerificationProfileConfig
	try {
		parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as RawVerificationProfileConfig
	} catch (err) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, err instanceof Error ? err.message : String(err)),
		}
	}

	const rawProfile = parsed.verificationProfile
	if (!rawProfile || typeof rawProfile !== "object") {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, 'expected a top-level "verificationProfile" object'),
		}
	}

	const name = typeof rawProfile.name === "string" ? rawProfile.name.trim() : ""
	if (!name) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, "verificationProfile.name must be a non-empty string"),
		}
	}

	const command = typeof rawProfile.command === "string" ? rawProfile.command.trim() : ""
	if (!command) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, "verificationProfile.command must be a non-empty string"),
		}
	}

	const cwd = typeof rawProfile.cwd === "string" && rawProfile.cwd.trim() ? rawProfile.cwd.trim() : "."
	const profileClassRaw = typeof rawProfile.profileClass === "string" ? rawProfile.profileClass.trim() : ""
	const profileClass = profileClassRaw ? getSupportedVerificationProfileClass(profileClassRaw)?.profileClass ?? null : null
	if (profileClassRaw && !profileClass) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(
				sourcePath,
				`verificationProfile.profileClass must be one of: ${formatSupportedVerificationProfileClasses()}`,
			),
		}
	}

	const rawTimeout = rawProfile.timeoutMs
	const timeoutNumber =
		typeof rawTimeout === "number"
			? rawTimeout
			: typeof rawTimeout === "string" && rawTimeout.trim()
				? Number.parseInt(rawTimeout, 10)
				: runtimeConfig.verificationProfileDefaultTimeoutMs
	if (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, "verificationProfile.timeoutMs must be a positive integer when provided"),
		}
	}

	const fileScopeHint = normalizeHintEntries(rawProfile.fileScopeHint)
	if (fileScopeHint === null) {
		return {
			profile: null,
			sourcePath,
			issue: formatProfileIssue(sourcePath, "verificationProfile.fileScopeHint must be an array of repo-relative strings"),
		}
	}

	const normalizedCwd = normalizeRelPath(cwd) || "."
	const normalizedTimeoutMs = Math.min(timeoutNumber, runtimeConfig.verificationProfileMaxTimeoutMs)
	const manifestHash = typeof rawProfile.manifestHash === "string" ? rawProfile.manifestHash.trim() : ""
	const rawPolicyPack = parsed.policyPack
	const policyPackIdRaw = rawPolicyPack && typeof rawPolicyPack === "object" && typeof rawPolicyPack.packId === "string"
		? rawPolicyPack.packId.trim()
		: ""
	let policyPackId: SupportedPolicyPackId | null = null
	if (policyPackIdRaw) {
		if (
			policyPackIdRaw !== "oss_default_v1" &&
			policyPackIdRaw !== "ci_safe_v1" &&
			policyPackIdRaw !== "enterprise_strict_v1"
		) {
			return {
				profile: null,
				sourcePath,
				issue: formatProfileIssue(sourcePath, `policyPack.packId must be one of: ${formatSupportedPolicyPacks()}`),
			}
		}
		policyPackId = policyPackIdRaw
	}
	let executorAdapterId: SupportedExecutorAdapterId | null = null

	if (profileClass) {
		executorAdapterId = getSupportedVerificationProfileClass(profileClass)?.adapterId ?? null
		const classIssue = validateVerificationProfileClassCommand(profileClass, command)
		if (classIssue) {
			return {
				profile: null,
				sourcePath,
				issue: formatProfileIssue(sourcePath, classIssue),
			}
		}

		if (!manifestHash) {
			return {
				profile: null,
				sourcePath,
				issue: formatProfileIssue(
					sourcePath,
					"verificationProfile.manifestHash is required when verificationProfile.profileClass is set",
				),
			}
		}

		const policyIssue = validatePolicyPackProfileClass(policyPackId ?? "oss_default_v1", profileClass)
		if (policyIssue) {
			return {
				profile: null,
				sourcePath,
				issue: formatProfileIssue(sourcePath, policyIssue),
			}
		}

		const expectedManifestHash = computeVerificationProfileManifestHash(
			buildVerificationProfileManifestCore({
				profileClass,
				name,
				command,
				cwd: normalizedCwd,
				timeoutMs: normalizedTimeoutMs,
				fileScopeHint,
			}),
		)
		if (manifestHash !== expectedManifestHash) {
			return {
				profile: null,
				sourcePath,
				issue: formatProfileIssue(
					sourcePath,
					`verificationProfile.manifestHash drifted: expected ${expectedManifestHash} but found ${manifestHash}`,
				),
			}
		}
	}

	return {
		profile: {
			name,
			profileClass,
			executorAdapterId: profileClass ? executorAdapterId : null,
			policyPackId,
			manifestHash: manifestHash || null,
			command,
			cwd: normalizedCwd,
			timeoutMs: normalizedTimeoutMs,
			fileScopeHint,
			sourcePath,
		},
		sourcePath,
		issue: null,
	}
}

export async function runRepoVerificationProfile(
	configWorkspace: string,
	executionWorkspace: string,
	changedFiles: string[],
	options: {
		isCodeChangingTask: boolean
		runtimeConfig?: RuntimeConfig
	} = { isCodeChangingTask: true },
): Promise<VerificationProfileResult> {
	const runtimeConfig = options.runtimeConfig ?? resolveRuntimeConfig(process.env)
	const loadResult = loadRepoVerificationProfile(configWorkspace, { runtimeConfig })

	if (loadResult.issue) {
		return {
			status: "blocked",
			applied: false,
			applicability: "invalid_profile",
			profileName: null,
			profileClass: null,
			executorAdapterId: null,
			policyPackId: null,
			manifestHash: null,
			sourcePath: loadResult.sourcePath,
			command: null,
			cwd: null,
			timeoutMs: null,
			fileScopeHint: [],
			matchedChangedFiles: [],
			message: loadResult.issue,
			details: [loadResult.issue],
			stdout: "",
			stderr: "",
			exitCode: null,
		}
	}

	if (!loadResult.profile) {
		return buildNotApplicableResult(
			loadResult,
			"no_profile_declared",
			"No verification profile was declared for this repo.",
			[`Add ${PROFILE_CONFIG_FILENAME} if you want SwarmCoder V2 to run a post-edit local check.`],
		)
	}

	if (!options.isCodeChangingTask) {
		return buildNotApplicableResult(
			loadResult,
			"non_code_task",
			"No verification profile applied because this task does not appear to change code.",
			["Verification profiles only run for code-changing tasks with local diff evidence."],
		)
	}

	const normalizedChangedFiles = Array.from(new Set(changedFiles.map((file) => normalizeRelPath(file)).filter(Boolean)))
	if (normalizedChangedFiles.length === 0) {
		return buildNotApplicableResult(
			loadResult,
			"no_changed_files",
			"No verification profile applied because no changed files were recorded.",
			["Verification stays truthful and does not invent a passing local check when there is no diff evidence."],
		)
	}

	const matchedChangedFiles =
		loadResult.profile.fileScopeHint.length === 0
			? [...normalizedChangedFiles]
			: normalizedChangedFiles.filter((changedFile) =>
					loadResult.profile?.fileScopeHint.some((hint) => matchesFileScopeHint(changedFile, hint)),
				)

	if (loadResult.profile.fileScopeHint.length > 0 && matchedChangedFiles.length === 0) {
		return buildNotApplicableResult(
			loadResult,
			"scope_hint_miss",
			`Verification profile "${loadResult.profile.name}" did not apply to the changed files.`,
			[
				`Changed files: ${normalizedChangedFiles.join(", ")}`,
				`Profile file scope hint: ${loadResult.profile.fileScopeHint.join(", ")}`,
			],
		)
	}

	let resolvedCwd: string
	try {
		resolvedCwd = path.resolve(executionWorkspace, loadResult.profile.cwd)
		WorkspaceLock.validatePath(resolvedCwd, executionWorkspace)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			status: "blocked",
			applied: false,
			applicability: "applied",
			profileName: loadResult.profile.name,
			profileClass: loadResult.profile.profileClass,
			executorAdapterId: loadResult.profile.executorAdapterId,
			policyPackId: loadResult.profile.policyPackId,
			manifestHash: loadResult.profile.manifestHash,
			sourcePath: loadResult.profile.sourcePath,
			command: loadResult.profile.command,
			cwd: loadResult.profile.cwd,
			timeoutMs: loadResult.profile.timeoutMs,
			fileScopeHint: [...loadResult.profile.fileScopeHint],
			matchedChangedFiles,
			message: `Verification profile "${loadResult.profile.name}" was blocked by the workspace lock.`,
			details: [message],
			stdout: "",
			stderr: "",
			exitCode: null,
		}
	}

	const validation = CommandGate.validate(loadResult.profile.command)
	if (!validation.allowed) {
		return {
			status: "blocked",
			applied: false,
			applicability: "applied",
			profileName: loadResult.profile.name,
			profileClass: loadResult.profile.profileClass,
			executorAdapterId: loadResult.profile.executorAdapterId,
			policyPackId: loadResult.profile.policyPackId,
			manifestHash: loadResult.profile.manifestHash,
			sourcePath: loadResult.profile.sourcePath,
			command: loadResult.profile.command,
			cwd: loadResult.profile.cwd,
			timeoutMs: loadResult.profile.timeoutMs,
			fileScopeHint: [...loadResult.profile.fileScopeHint],
			matchedChangedFiles,
			message: `Verification profile "${loadResult.profile.name}" was blocked by CommandGate.`,
			details: [
				validation.reason ?? "CommandGate blocked the verification command.",
				`Supported manifest-backed profile classes: ${formatSupportedVerificationProfileClasses()}`,
			],
			stdout: "",
			stderr: "",
			exitCode: null,
		}
	}

	try {
		const execution = await CommandGate.run(loadResult.profile.command, resolvedCwd, {
			timeoutMs: loadResult.profile.timeoutMs,
			maxOutputChars: runtimeConfig.verificationProfileMaxOutputChars,
		})
		return {
			status: "passed",
			applied: true,
			applicability: "applied",
			profileName: loadResult.profile.name,
			profileClass: loadResult.profile.profileClass,
			executorAdapterId: loadResult.profile.executorAdapterId,
			policyPackId: loadResult.profile.policyPackId,
			manifestHash: loadResult.profile.manifestHash,
			sourcePath: loadResult.profile.sourcePath,
			command: loadResult.profile.command,
			cwd: loadResult.profile.cwd,
			timeoutMs: loadResult.profile.timeoutMs,
			fileScopeHint: [...loadResult.profile.fileScopeHint],
			matchedChangedFiles,
			message: `Verification profile "${loadResult.profile.name}" passed.`,
			details: [`Command: ${loadResult.profile.command}`, `Working directory: ${loadResult.profile.cwd}`],
			stdout: execution.stdout,
			stderr: execution.stderr,
			exitCode: execution.code,
		}
	} catch (err) {
		const executionError = err instanceof CommandExecutionError ? err : null
		const timedOut = executionError?.timedOut === true
		return {
			status: timedOut ? "timed_out" : "failed",
			applied: true,
			applicability: "applied",
			profileName: loadResult.profile.name,
			profileClass: loadResult.profile.profileClass,
			executorAdapterId: loadResult.profile.executorAdapterId,
			policyPackId: loadResult.profile.policyPackId,
			manifestHash: loadResult.profile.manifestHash,
			sourcePath: loadResult.profile.sourcePath,
			command: loadResult.profile.command,
			cwd: loadResult.profile.cwd,
			timeoutMs: loadResult.profile.timeoutMs,
			fileScopeHint: [...loadResult.profile.fileScopeHint],
			matchedChangedFiles,
			message: timedOut
				? `Verification profile "${loadResult.profile.name}" timed out after ${loadResult.profile.timeoutMs}ms.`
				: `Verification profile "${loadResult.profile.name}" failed.`,
			details: [err instanceof Error ? err.message : String(err)],
			stdout: executionError?.stdout ?? "",
			stderr: executionError?.stderr ?? "",
			exitCode: executionError?.code ?? null,
		}
	}
}
