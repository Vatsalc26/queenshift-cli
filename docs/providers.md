# Queenshift Provider Setup

## Short Path

1. run `queenshift doctor`
2. if doctor is not ready yet, choose one provider path below
3. run `queenshift doctor` again until it reports `Ready: yes`
4. run `queenshift owner:guided:demo`
5. run `queenshift demo:run` before a real repo
6. run `queenshift repo:onboard --workspace <repo>` before the first real repo task
7. preflight the first real task with `queenshift "<task>" --workspace <repo> --admitOnly`
8. if the guided or disposable demo fails, run `queenshift demo:reset` and retry the same demo command

## Fastest Recommended Path

### Gemini CLI OAuth

1. install the `gemini` CLI and make sure it is on `PATH`
2. sign in once so `~/.gemini/oauth_creds.json` exists
3. keep the provider explicit with `SWARM_PROVIDER=gemini` and `SWARM_GEMINI_AUTH=cli`
4. optionally set `SWARM_MODEL` to a supported Gemini model
5. run `queenshift doctor`

### OpenAI API key

1. set `SWARM_PROVIDER=openai`
2. set `OPENAI_API_KEY`
3. optionally set `SWARM_MODEL` to a supported OpenAI model
4. run `queenshift doctor`

## Other Supported Gemini Paths

These Gemini environment-driven paths keep `SWARM_GEMINI_AUTH` explicit instead of guessing:

1. API key: set `SWARM_PROVIDER=gemini`, `SWARM_GEMINI_AUTH=api_key`, and `GEMINI_API_KEY`
2. Access token plus project: set `SWARM_PROVIDER=gemini`, `SWARM_GEMINI_AUTH=access_token`, `GEMINI_ACCESS_TOKEN`, and `GEMINI_USER_PROJECT`
3. ADC plus project: set `SWARM_PROVIDER=gemini`, `SWARM_GEMINI_AUTH=adc`, and `GEMINI_USER_PROJECT`

## Fail-Closed Rules

1. no hidden credential storage is added here
2. Queenshift does not silently switch between Gemini and OpenAI
3. a live run should not start until the provider path is explicit and ready
4. provider setup stays on `queenshift` product commands instead of asking the user to start with low-level verification wrappers
