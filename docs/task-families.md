# Queenshift Task Families

Queenshift is strongest when the task is explicit, file-named, and small.

## Best First Tasks

These are the calmer starter families:

1. `comment_file`
2. `create_tiny_file`
3. `update_named_file`
4. `update_file_and_test`
5. `sync_docs_with_source`
6. `rename_export`

For `update_file_and_test`, name one source file and one direct local test file.

For `rename_export`, keep the request anchored on one named source file and its direct local call sites.

## Bounded Follow-On Tasks

These families exist, but they are not first-run defaults:

1. `sync_docs_bundle`
2. `bounded_two_file_update`
3. `medium_multi_file_update`
4. `cross_language_sync`

Treat the follow-on families as review-biased and more deliberate than the calmer starters.

## First-Run Rules

1. start with `queenshift demo:gallery` or the guided demo before a real repo
2. name the file you want to change
3. keep the first task tiny
4. use `queenshift repo:onboard` and `queenshift "<task>" --workspace <repo> --admitOnly` before a real repo
5. avoid broad repo-wide or dependency-changing requests

## Example And Progress Expectations

Example and progress surfaces should keep three things visible:

1. the bounded task family
2. the named target files
3. the progress steps or stop reason while the run is happening

Experimental candidate paths should stay explicitly labeled and should not be confused with the shipped default engine story.

For the current live, experimental, and benchmark reading behind these families, read [evidence.md](./evidence.md).
