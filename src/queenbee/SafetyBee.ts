import { evaluateAdmission, type AdmissionInput, type AdmissionReport } from "../run/AdmissionGate"
import { resolveRuntimeConfig } from "../run/RuntimeConfig"
import { CommandGate, type ValidationResult } from "../safety/CommandGate"
import { WorkspaceLock } from "../safety/WorkspaceLock"

export type QueenBeeWorkspaceValidationResult = {
	allowed: boolean
	reason: string | null
}

export type QueenBeeGuardrailPolicySnapshot = {
	overallRunCeilingMs: number
	providerCallTimeoutMs: number
	agentWaitTimeoutMs: number
	maxConcurrentLiveRunsPerWorkspace: number
	maxModelCallsPerRun: number
	smallTaskMaxModelCalls: number
	mediumTaskMaxModelCalls: number
	maxEstimatedTokensPerRun: number
	smallTaskMaxEstimatedTokens: number
	mediumTaskMaxEstimatedTokens: number
}

export class SafetyBee {
	async evaluateMissionAdmission(input: AdmissionInput): Promise<AdmissionReport> {
		return await evaluateAdmission(input)
	}

	validateCommandPolicy(command: string): ValidationResult {
		return CommandGate.validate(command)
	}

	validateWorkspacePath(workspace: string, targetPath: string): QueenBeeWorkspaceValidationResult {
		try {
			WorkspaceLock.validatePath(targetPath, workspace)
			return {
				allowed: true,
				reason: null,
			}
		} catch (err) {
			return {
				allowed: false,
				reason: err instanceof Error ? err.message : String(err),
			}
		}
	}

	readGuardrailPolicy(env: NodeJS.ProcessEnv = process.env): QueenBeeGuardrailPolicySnapshot {
		const runtimeConfig = resolveRuntimeConfig(env)
		return {
			overallRunCeilingMs: runtimeConfig.overallRunCeilingMs,
			providerCallTimeoutMs: runtimeConfig.providerCallTimeoutMs,
			agentWaitTimeoutMs: runtimeConfig.agentWaitTimeoutMs,
			maxConcurrentLiveRunsPerWorkspace: runtimeConfig.maxConcurrentLiveRunsPerWorkspace,
			maxModelCallsPerRun: runtimeConfig.maxModelCallsPerRun,
			smallTaskMaxModelCalls: runtimeConfig.smallTaskMaxModelCalls,
			mediumTaskMaxModelCalls: runtimeConfig.mediumTaskMaxModelCalls,
			maxEstimatedTokensPerRun: runtimeConfig.maxEstimatedTokensPerRun,
			smallTaskMaxEstimatedTokens: runtimeConfig.smallTaskMaxEstimatedTokens,
			mediumTaskMaxEstimatedTokens: runtimeConfig.mediumTaskMaxEstimatedTokens,
		}
	}
}
