export const TASK_CORPUS_IDS = [
	"comment_file",
	"create_tiny_file",
	"update_named_file",
	"update_file_and_test",
	"sync_docs_with_source",
	"rename_export",
	"sync_docs_bundle",
	"bounded_two_file_update",
	"medium_multi_file_update",
	"cross_language_sync",
] as const

export type TaskCorpusId = (typeof TASK_CORPUS_IDS)[number]
