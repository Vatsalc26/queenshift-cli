import fs from "node:fs"
import path from "node:path"

import { evaluateAdmission } from "../src/run/AdmissionGate"
import { resolveRuntimeConfig } from "../src/run/RuntimeConfig"
import { createTempTestRepoCopy } from "./test_workspace_baseline"

type AdmissionDecision = "allow" | "allow_with_review_bias" | "refuse"

type AdmissionCliResult = {
	decision?: AdmissionDecision
	reasonCodes?: string[]
	task?: {
		decision?: AdmissionDecision
		reasonCodes?: string[]
		targetFiles?: string[]
		derivedTaskContract?: {
			scope?: {
				allowedFiles?: string[]
			}
		}
	}
	repo?: {
		decision?: AdmissionDecision
		reasonCodes?: string[]
	}
}

export type AdmissionHarnessResult = {
	cleanSafeRepoAdmitted: boolean
	dirtyRepoRefused: boolean
	unsupportedTaskRefused: boolean
	scopedSafeTaskAdmitted: boolean
	missingVerificationProfileSurfaced: boolean
	largeRepoTier2Admitted: boolean
	largeRepoTierSurfaced: boolean
	details: string[]
}

function resolveRootDir(): string {
	const candidate = path.join(__dirname, "..")
	return fs.existsSync(path.join(candidate, "package.json")) ? candidate : path.join(candidate, "..")
}

async function createTempRepoCopy(rootDir: string, label: string): Promise<{ repoPath: string; cleanup: () => void }> {
	return await createTempTestRepoCopy(rootDir, `admission-${label}`)
}

async function runAdmissionCli(
	rootDir: string,
	repoPath: string,
	task: string,
	options: { allowDirty?: boolean } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; parsed: AdmissionCliResult | null }> {
	const report = await evaluateAdmission({
		workspace: repoPath,
		task,
		allowDirty: options.allowDirty,
	})
	return {
		code: report.decision === "refuse" ? 2 : 0,
		stdout: `${JSON.stringify(report, null, 2)}\n`,
		stderr: "",
		parsed: report as AdmissionCliResult,
	}
}

export async function runAdmissionHarness(rootDir = resolveRootDir()): Promise<AdmissionHarnessResult> {
	const details: string[] = []

	const cleanRepo = await createTempRepoCopy(rootDir, "clean")
	const dirtyRepo = await createTempRepoCopy(rootDir, "dirty")
	const unsupportedRepo = await createTempRepoCopy(rootDir, "unsupported")
	const scopedRepo = await createTempRepoCopy(rootDir, "scoped")
	const verificationRepo = await createTempRepoCopy(rootDir, "verification")
	const largeRepo = await createTempRepoCopy(rootDir, "large-tier")

	try {
		const cleanResult = await runAdmissionCli(rootDir, cleanRepo.repoPath, "add a brief comment to hello.ts")
		const cleanSafeRepoAdmitted =
			cleanResult.code === 0 &&
			cleanResult.parsed?.decision === "allow" &&
			cleanResult.parsed?.repo?.decision === "allow" &&
			cleanResult.parsed?.task?.decision === "allow"
		details.push(`clean decision=${cleanResult.parsed?.decision ?? "null"}`)

		fs.appendFileSync(path.join(dirtyRepo.repoPath, "hello.ts"), "\n// dirty admission fixture\n", "utf8")
		const dirtyResult = await runAdmissionCli(rootDir, dirtyRepo.repoPath, "add a brief comment to hello.ts")
		const dirtyRepoRefused =
			dirtyResult.code === 2 &&
			dirtyResult.parsed?.decision === "refuse" &&
			(dirtyResult.parsed?.repo?.reasonCodes ?? []).includes("dirty_workspace")
		details.push(`dirty decision=${dirtyResult.parsed?.decision ?? "null"} code=${String(dirtyResult.code)}`)

		const unsupportedResult = await runAdmissionCli(
			rootDir,
			unsupportedRepo.repoPath,
			"install dependencies and migrate the database",
		)
		const unsupportedTaskRefused =
			unsupportedResult.code === 2 &&
			unsupportedResult.parsed?.decision === "refuse" &&
			(unsupportedResult.parsed?.task?.reasonCodes ?? []).includes("unsupported_task_verb")

		const scopedResult = await runAdmissionCli(rootDir, scopedRepo.repoPath, "update hello.ts and utils.ts together")
		const allowedFiles = scopedResult.parsed?.task?.derivedTaskContract?.scope?.allowedFiles ?? []
		const scopedSafeTaskAdmitted =
			scopedResult.code === 0 &&
			scopedResult.parsed?.decision === "allow_with_review_bias" &&
			scopedResult.parsed?.task?.decision === "allow_with_review_bias" &&
			Array.isArray(allowedFiles) &&
			allowedFiles.slice().sort().join(",") === ["hello.ts", "utils.ts"].join(",")
		details.push(`scoped decision=${scopedResult.parsed?.decision ?? "null"} files=${allowedFiles.join(",")}`)

		const verificationResult = await runAdmissionCli(
			rootDir,
			verificationRepo.repoPath,
			"run npm test and add a brief comment to hello.ts",
		)
		const missingVerificationProfileSurfaced =
			verificationResult.code === 2 &&
			verificationResult.parsed?.decision === "refuse" &&
			(verificationResult.parsed?.task?.reasonCodes ?? []).includes("missing_verification_profile")
		details.push(`verification decision=${verificationResult.parsed?.decision ?? "null"} code=${String(verificationResult.code)}`)

		for (let index = 0; index < 8; index++) {
			fs.writeFileSync(path.join(largeRepo.repoPath, `extra-${index}.ts`), `export const value${index} = ${index}\n`, "utf8")
		}
		const tightRuntimeConfig = {
			...resolveRuntimeConfig(process.env),
			admissionMaxRepoFileCount: 5,
			admissionTier2MaxRepoFileCount: 12,
		}
		const tier2RepoReport = await evaluateAdmission({
			workspace: largeRepo.repoPath,
			task: "add a brief comment to hello.ts",
			allowDirty: true,
			runtimeConfig: tightRuntimeConfig,
		})
		const largeRepoTier2Admitted =
			tier2RepoReport.decision === "allow_with_review_bias" &&
			tier2RepoReport.repo.decision === "allow_with_review_bias" &&
			tier2RepoReport.repo.supportTier === "large_supported_tier_2" &&
			tier2RepoReport.repo.reasonCodes.includes("large_repo_tier_2") &&
			tier2RepoReport.repo.details.some((detail) => detail.includes("tier 2 candidate"))
		details.push(`tier2 decision=${tier2RepoReport.decision} tier=${tier2RepoReport.repo.supportTier}`)

		for (let index = 8; index < 18; index++) {
			fs.writeFileSync(path.join(largeRepo.repoPath, `tier3-${index}.ts`), `export const over${index} = ${index}\n`, "utf8")
		}
		const largeRepoReport = await evaluateAdmission({
			workspace: largeRepo.repoPath,
			task: "add a brief comment to hello.ts",
			allowDirty: true,
			runtimeConfig: tightRuntimeConfig,
		})
		const largeRepoTierSurfaced =
			largeRepoReport.decision === "refuse" &&
			largeRepoReport.repo.supportTier === "large_refused" &&
			largeRepoReport.repo.supportTierLabel.includes("Large") &&
			largeRepoReport.repo.details.some((detail) => detail.includes("Support tier:")) &&
			largeRepoReport.repo.reasonCodes.includes("repo_file_count_limit_exceeded")
		details.push(`large tier=${largeRepoReport.repo.supportTier} label=${largeRepoReport.repo.supportTierLabel}`)

		return {
			cleanSafeRepoAdmitted,
			dirtyRepoRefused,
			unsupportedTaskRefused,
			scopedSafeTaskAdmitted,
			missingVerificationProfileSurfaced,
			largeRepoTier2Admitted,
			largeRepoTierSurfaced,
			details,
		}
	} finally {
		cleanRepo.cleanup()
		dirtyRepo.cleanup()
		unsupportedRepo.cleanup()
		scopedRepo.cleanup()
		verificationRepo.cleanup()
		largeRepo.cleanup()
	}
}

export function formatAdmissionHarnessResult(result: AdmissionHarnessResult): string {
	return [
		`Clean safe repo admitted: ${result.cleanSafeRepoAdmitted ? "PASS" : "FAIL"}`,
		`Dirty repo refused: ${result.dirtyRepoRefused ? "PASS" : "FAIL"}`,
		`Unsupported task refused: ${result.unsupportedTaskRefused ? "PASS" : "FAIL"}`,
		`Explicit scoped safe task admitted: ${result.scopedSafeTaskAdmitted ? "PASS" : "FAIL"}`,
		`Missing verification profile surfaced: ${result.missingVerificationProfileSurfaced ? "PASS" : "FAIL"}`,
		`Large repo tier 2 admitted: ${result.largeRepoTier2Admitted ? "PASS" : "FAIL"}`,
		`Large repo tier surfaced: ${result.largeRepoTierSurfaced ? "PASS" : "FAIL"}`,
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runAdmissionHarness()
	console.log(formatAdmissionHarnessResult(result))
	process.exit(
		result.cleanSafeRepoAdmitted &&
			result.dirtyRepoRefused &&
		result.unsupportedTaskRefused &&
			result.scopedSafeTaskAdmitted &&
			result.missingVerificationProfileSurfaced &&
			result.largeRepoTier2Admitted &&
			result.largeRepoTierSurfaced
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:admission] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
