import path from "node:path"

import { formatQueenshiftWorkspaceCommand } from "../cli/CommandSurface"
import {
	DEMO_REPO_PACK_RUN_COMMAND,
	DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH,
} from "./DemoRepoPack"
import { OWNER_GUIDED_DEMO_TASK } from "./OwnerProfileManifest"
import type { TaskCorpusId } from "./TaskCorpusIds"

export type DemoGalleryExample = {
	id: string
	corpusTaskId: TaskCorpusId
	title: string
	lane: string
	task: string
	surface: string
	proofSource: string[]
	reproductionCommand: string
	replayCommand: string
	diffCommand: string
	notes: string[]
}

export type DemoGallery = {
	schemaVersion: 1
	generatedAt: string
	examples: DemoGalleryExample[]
}

function quotePath(value: string): string {
	return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function resolveDemoWorkspace(rootDir: string): string {
	return path.join(rootDir, DEMO_REPO_PACK_WORKSPACE_RELATIVE_PATH)
}

export function buildDemoGallery(rootDir: string): DemoGallery {
	const demoWorkspace = resolveDemoWorkspace(rootDir)
	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		examples: [
			{
				id: "demo-pack-comment",
				corpusTaskId: "comment_file",
				title: "Disposable comment addition",
				lane: "small live demo pack",
				task: OWNER_GUIDED_DEMO_TASK,
				surface: "demo:run",
				proofSource: ["npm.cmd run verify:demo:run", "npm.cmd run verify:replay-export", "npm.cmd run task-corpus:report"],
				reproductionCommand: DEMO_REPO_PACK_RUN_COMMAND,
				replayCommand: formatQueenshiftWorkspaceCommand(["replay:latest"], demoWorkspace),
				diffCommand: `git -C ${quotePath(demoWorkspace)} show --stat HEAD`,
				notes: [
					"Best first run for a stranger because it stages a disposable repo copy.",
					"Non-production and non-credit by design.",
				],
			},
			{
				id: "guided-note-file",
				corpusTaskId: "create_tiny_file",
				title: "One-file note creation",
				lane: "small guided preview",
				task: "create notes.md with one sentence describing this repo",
				surface: "guided shell starter library",
				proofSource: ["npm.cmd run verify:owner:task-library", "npm.cmd run verify:task-composer", "npm.cmd run task-corpus:report"],
				reproductionCommand: "Open the thin shell, choose Guided, then pick the note-creation starter task.",
				replayCommand: "Replay appears after you run the composed task on your own clean repo.",
				diffCommand: "Use the summary Changed files list plus git show after the run completes.",
				notes: [
					"Calmest starter for a noncoder because the task text is generated transparently before launch.",
					"Stays in the canonical owner path instead of a hidden planner.",
				],
			},
			{
				id: "guided-rename-export",
				corpusTaskId: "rename_export",
				title: "Small rename with direct call sites",
				lane: "semi-open guided preview",
				task: "rename the export in src/format.ts to formatValue and update its direct call sites",
				surface: "guided shell starter library",
				proofSource: ["npm.cmd run verify:owner:task-library", "npm.cmd run verify:lane:semiopen", "npm.cmd run task-corpus:report"],
				reproductionCommand: "Open the thin shell, choose Guided, then pick the rename-export starter and preview the lane.",
				replayCommand: "Use replay:latest on the target workspace after the run to inspect the event sequence.",
				diffCommand: "Use git show --stat HEAD in the target workspace after the run.",
				notes: [
					"Good second task when you want a bounded rename with derived local call-site scope.",
					"Fails closed outside the anchored rename-export discovery rules.",
				],
			},
			{
				id: "bounded-two-file-update",
				corpusTaskId: "bounded_two_file_update",
				title: "Bounded two-file coordination",
				lane: "scoped coordination",
				task: "update hello.ts and utils.ts together",
				surface: "CLI or guided owner flow",
				proofSource: ["npm.cmd run verify:progress-map", "npm.cmd run verify:replay-export", "npm.cmd run task-corpus:report"],
				reproductionCommand: formatQueenshiftWorkspaceCommand(["--task", "update hello.ts and utils.ts together", "--dryRun"], demoWorkspace),
				replayCommand: formatQueenshiftWorkspaceCommand(["replay:latest"], demoWorkspace),
				diffCommand: "Dry-run produces replay and summary without mutating files; use a clean real repo for a live diff.",
				notes: [
					"Good trust-building example because the run records plan, progress, replay, and outcome artifacts.",
					"Shows coordination truth without pretending a full repo-wide planner exists.",
				],
			},
			{
				id: "medium-six-file-update",
				corpusTaskId: "medium_multi_file_update",
				title: "Explicit medium bounded lane",
				lane: "medium bounded",
				task: "update hello.ts, utils.ts, package.json, notes.md, guide.md, and extra.ts together",
				surface: "CLI dry-run or engineering proof",
				proofSource: ["npm.cmd run verify:lane:medium", "npm.cmd run verify:replay-export", "npm.cmd run task-corpus:report"],
				reproductionCommand: formatQueenshiftWorkspaceCommand(
					["--task", "update hello.ts, utils.ts, package.json, notes.md, guide.md, and extra.ts together", "--dryRun"],
					demoWorkspace,
				),
				replayCommand: formatQueenshiftWorkspaceCommand(["replay:latest"], demoWorkspace),
				diffCommand: "Use a clean owned repo for live medium-lane diffs; the bundled demo repo stays intentionally smaller.",
				notes: [
					"Use only when the file list is explicit and still within the supported 6-10 file medium lane.",
					"Critic, retry, and checkpoint artifacts stay part of the evidence path.",
				],
			},
		],
	}
}

export function formatDemoGallery(gallery: DemoGallery): string {
	return [
		"Queenshift Demo Gallery",
		...gallery.examples.flatMap((example) => [
			"",
			`${example.title}`,
			`Lane: ${example.lane}`,
			`Surface: ${example.surface}`,
			`Task: ${example.task}`,
			`Try it: ${example.reproductionCommand}`,
			`Replay: ${example.replayCommand}`,
			`Diff: ${example.diffCommand}`,
			`Proof: ${example.proofSource.join(" | ")}`,
			...example.notes.map((note) => `- ${note}`),
		]),
	].join("\n")
}
