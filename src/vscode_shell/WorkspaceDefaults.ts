import fs from "node:fs"
import path from "node:path"

import { evaluateRepoReadiness } from "../run/AdmissionGate"

export const SHELL_WORKSPACE_SELECTION_PROMPT =
	"Choose a small clean target repo before running admission or launch."

function uniqueCandidates(paths: string[]): string[] {
	return Array.from(
		new Set(
			paths
				.map((entry) => entry.trim())
				.filter(Boolean)
				.map((entry) => path.resolve(entry)),
		),
	)
}

export async function chooseInitialShellWorkspace(candidatePaths: string[]): Promise<string> {
	for (const candidatePath of uniqueCandidates(candidatePaths)) {
		try {
			if (!fs.existsSync(candidatePath)) continue
			if (!fs.statSync(candidatePath).isDirectory()) continue
			const readiness = await evaluateRepoReadiness(candidatePath)
			if (readiness.decision !== "refuse") {
				return candidatePath
			}
		} catch {
			// Ignore bad candidates and keep looking for a safe default.
		}
	}

	return ""
}
