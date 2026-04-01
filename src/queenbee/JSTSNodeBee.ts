import fs from "node:fs"
import path from "node:path"

import type { QueenBeeEnvelope } from "./QueenBeeProtocol"
import type { QueenBeeFileProposal, QueenBeeWorkResultPayload } from "./JSTSCoderBee"
import {
	JSTSCoreBee,
	SUPPORTED_JS_TS_EXTENSIONS,
	extractQuotedSnippet,
	insertSnippet,
	normalizeRelPath,
	parseAssignmentPacketPayload,
	refusal,
} from "./JSTSCoreBee"

const PACKAGE_MANIFEST_NAME = "package.json"
const NODE_TASK_FAMILY = "bounded_node_cli_task"
const NODE_SIGNAL_PATTERN = /(package\.json|process\.env|process\.argv|child_process|#!\/usr\/bin\/env node|npm run|\bcli\b|\bargv\b|\bstdin\b|\bstdout\b|\bstderr\b|commander|yargs|fs\/promises)/iu

function retagNodeSummary(summary: string): string {
	let tagged = summary.replace(/JSTSCoreBee/g, "JSTSNodeBee")
	tagged = tagged.replace("bounded JS/TS", "bounded Node/CLI")
	tagged = tagged.replace("bounded source-and-test proposal set", "node-aware bounded source-and-test proposal set")
	tagged = tagged.replace("bounded two-file proposal set", "node-aware bounded two-file proposal set")
	tagged = tagged.replace("one-file proposal", "node-aware one-file proposal")
	if (tagged.includes("source-and-test proposal snippet")) {
		return tagged.replace("source-and-test proposal snippet", "Node/CLI source-and-test proposal snippet")
	}
	return tagged.replace("proposal snippet", "Node/CLI proposal snippet")
}

function isPackageManifest(targetFile: string): boolean {
	const normalized = normalizeRelPath(targetFile).toLowerCase()
	return normalized === PACKAGE_MANIFEST_NAME || normalized.endsWith(`/${PACKAGE_MANIFEST_NAME}`)
}

function isSupportedNodeTarget(targetFile: string): boolean {
	if (isPackageManifest(targetFile)) return true
	return SUPPORTED_JS_TS_EXTENSIONS.has(path.extname(targetFile).toLowerCase())
}

function readNodeEvidence(task: string, allowedFiles: string[], workspaceRoot: string): string {
	const fileContent = allowedFiles
		.map((targetFile) => path.join(workspaceRoot, targetFile))
		.filter((targetPath) => fs.existsSync(targetPath) && fs.statSync(targetPath).isFile())
		.map((targetPath) => fs.readFileSync(targetPath, "utf8"))
		.join("\n")
	return `${task}\n${allowedFiles.join("\n")}\n${fileContent}`
}

function buildNodeSnippet(task: string, targetFile: string): string {
	const exactSnippet = extractQuotedSnippet(task)
	if (exactSnippet) return exactSnippet
	const fileLabel = path.basename(targetFile, path.extname(targetFile))
	return `// queenbee: node cli update for ${fileLabel}`
}

function buildNodeScriptValue(entryFile: string): string {
	const normalized = normalizeRelPath(entryFile)
	const commandTarget = normalized.startsWith(".") ? normalized : `./${normalized}`
	return `node ${commandTarget}`.replace(/^node \.\/\.\//u, "node ./")
}

function buildPackageProposal(targetFile: string, allowedFiles: string[], beforeContent: string): QueenBeeFileProposal | null {
	const manifest = JSON.parse(beforeContent) as Record<string, unknown>
	const scriptsValue = manifest["scripts"]
	const scripts =
		scriptsValue && typeof scriptsValue === "object" && !Array.isArray(scriptsValue) ? { ...(scriptsValue as Record<string, unknown>) } : {}
	const entryFile = allowedFiles.find((targetFile) => !isPackageManifest(targetFile)) ?? "hello.ts"
	const scriptBase = path.basename(entryFile, path.extname(entryFile)) || "cli"
	const scriptName = `queenbee:node:${scriptBase}`
	const scriptValue = buildNodeScriptValue(entryFile)
	if (scripts[scriptName] === scriptValue) {
		return null
	}
	scripts[scriptName] = scriptValue
	const afterManifest = {
		...manifest,
		scripts,
	}
	const afterContent = `${JSON.stringify(afterManifest, null, 2)}\n`
	if (afterContent === beforeContent) return null
	return {
		path: targetFile,
		beforeContent,
		afterContent,
		changeSummary: `JSTSNodeBee added one bounded Node/CLI script proposal to ${targetFile}.`,
	}
}

export class JSTSNodeBee extends JSTSCoreBee {
	override codeAssignment(envelope: QueenBeeEnvelope): QueenBeeWorkResultPayload {
		const payload = parseAssignmentPacketPayload(envelope.payload)
		if (!payload) {
			return refusal("invalid_assignment_packet_payload", "JSTSNodeBee refused the assignment because the packet payload was incomplete.")
		}
		if (payload.taskFamily !== NODE_TASK_FAMILY) {
			const result = super.codeAssignment(envelope)
			return {
				...result,
				proposals: result.proposals.map((proposal) => ({
					...proposal,
					changeSummary: retagNodeSummary(proposal.changeSummary),
				})),
				coderSummary: retagNodeSummary(result.coderSummary),
			}
		}
		if (payload.languagePack !== "js_ts") {
			return refusal("unsupported_language_pack", "JSTSNodeBee stays inside the JS/TS-first candidate boundary.")
		}
		if (payload.allowedFiles.length < 1 || payload.allowedFiles.length > 2) {
			return refusal(
				"coder_target_count_out_of_bounds",
				"JSTSNodeBee keeps bounded_node_cli_task limited to one or two explicit Node/CLI files.",
			)
		}
		if (!NODE_SIGNAL_PATTERN.test(readNodeEvidence(payload.task, payload.allowedFiles, this.workspaceRoot))) {
			return refusal(
				"node_evidence_missing",
				"JSTSNodeBee refused the assignment because the bounded task did not surface package.json or Node/CLI evidence.",
			)
		}

		const proposals: QueenBeeFileProposal[] = []
		for (const targetFile of payload.allowedFiles) {
			if (!targetFile) {
				return refusal(
					"invalid_assignment_packet_payload",
					"JSTSNodeBee refused the assignment because a bounded target file was missing.",
				)
			}
			const targetPath = path.join(this.workspaceRoot, targetFile)
			if (!isSupportedNodeTarget(targetFile)) {
				return refusal("unsupported_file_extension", `JSTSNodeBee only accepts package.json or JS/TS files, not ${targetFile}.`)
			}
			if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
				return refusal("target_file_missing", `JSTSNodeBee could not read ${targetFile} inside the bounded workspace.`)
			}

			const beforeContent = fs.readFileSync(targetPath, "utf8")
			if (isPackageManifest(targetFile)) {
				let packageProposal: QueenBeeFileProposal | null = null
				try {
					packageProposal = buildPackageProposal(targetFile, payload.allowedFiles, beforeContent)
				} catch {
					return refusal("invalid_package_manifest", "JSTSNodeBee could not parse package.json inside the bounded workspace.")
				}
				if (!packageProposal) {
					return refusal("snippet_already_present", "JSTSNodeBee found the requested Node/CLI package proposal already present in package.json.")
				}
				proposals.push(packageProposal)
				continue
			}

			const snippet = buildNodeSnippet(payload.task, targetFile)
			const afterContent = insertSnippet(beforeContent, snippet)
			if (afterContent === beforeContent) {
				return refusal("snippet_already_present", `JSTSNodeBee found the requested snippet already present in ${targetFile}.`)
			}
			proposals.push({
				path: targetFile,
				beforeContent,
				afterContent,
				changeSummary: `JSTSNodeBee inserted one bounded Node/CLI proposal snippet into ${targetFile}.`,
			})
		}

		return {
			accepted: true,
			reason: null,
			changedFiles: [...payload.allowedFiles],
			proposalCount: proposals.length,
			proposals,
			coderSummary:
				proposals.length === 1
					? `JSTSNodeBee prepared a bounded Node/CLI proposal for ${payload.allowedFiles[0]} without merging it into the workspace.`
					: `JSTSNodeBee prepared a bounded Node/CLI proposal set for ${payload.allowedFiles.join(", ")} without merging it into the workspace.`,
		}
	}
}
