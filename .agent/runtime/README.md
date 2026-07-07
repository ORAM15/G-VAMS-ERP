# Autonomous Runtime Activation

Phase 2B wires the existing deterministic control plane to a pinned OpenHands headless runtime while keeping `runtime_mode` disabled by default.

## Verified upstream interface

The selected interface is the historical `openhands` CLI headless mode from OpenHands. Current docs describe headless mode for scripting, automation, and CI/CD; require `--task` or `--file`; show `openhands --headless -t "..."` and `openhands --headless -f task.txt`; document `--json` as JSONL event output; and state that headless mode always runs in always-approve mode. The Gemini docs state that OpenHands uses LiteLLM for Google chat models and that custom Gemini model identifiers use `gemini/<model-name>` such as `gemini/gemini-2.0-flash`.

## Pinned runtime

- Package/interface: `openhands` CLI.
- Pinned version: `1.16.0`.
- Reproducible install command used by the workflow: `python -m pip install openhands==1.16.0`.
- Runtime invocation: `openhands --override-with-envs --headless --json -f .agent/runtime/<stage>-task.txt`.

The adapter fails closed if the installed `openhands --version` output does not include `1.16.0`.

## Required GitHub settings for one manual supervised cycle

1. Secret `GEMINI_API_KEY` containing the Google Gemini API key.
2. Repository variable `AGENT_LLM_MODEL` containing a LiteLLM Gemini model identifier, for example `gemini/gemini-2.0-flash`.
3. Repository variable `AGENT_RUNTIME_MODE` set to `openhands`.

Scheduled runs remain observation/disabled-only during Phase 2B. After one successful manual supervised cycle, maintainers may intentionally change the schedule guard in `.github/workflows/autonomous-evolution.yml` to permit scheduled coding.

## Safety controls

The cycle records `.agent/runtime/base-state.json` at start. Diff enforcement compares the effective implementation delta to that trusted base SHA using `git diff <base> --name-only`, `git diff <base> --numstat`, and separate untracked-file inspection. Staging or runtime-created commits cannot hide changes because committed, staged, and unstaged tracked changes are compared against the same trusted base.

Validation commands are policy-checked and run with `shell: false`. The policy rejects shell chaining, pipes, redirection, command substitution, curl/wget, publishing, credential commands, destructive filesystem commands, and arbitrary interpreters. It accepts only controlled repository checks such as `node --check scripts/<file>.js` and selected `npm --prefix frontend|backend run build|test|lint` forms.
