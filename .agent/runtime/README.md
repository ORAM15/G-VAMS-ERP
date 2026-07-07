# Phase 2A Runtime Bridge

Phase 2A adds a deterministic runtime boundary for a future unattended G-VAMS coding loop. It does **not** connect a real OpenHands/Gemini implementation runtime yet.

## Current runtime status

` .agent/runtime/config.json ` sets `runtime_mode` to `disabled`. In disabled mode, `scripts/agent-runtime-adapter.js` writes a blocked `runtime-result.json`, exits safely, and performs no coding-agent execution.

## OpenHands integration status

OpenHands is the preferred future runtime, but this Phase 2A repository change does not claim a verified unattended OpenHands invocation. The adapter fails closed rather than inventing commands, container tags, API endpoints, provider variables, or model names.

### Phase 2B activation checklist

Before enabling `runtime_mode: "openhands"`, a human-supervised infrastructure PR must verify and document:

1. The exact supported OpenHands unattended CLI or container invocation.
2. The exact configuration mechanism for selecting a Gemini-compatible provider and model.
3. Immutable action/container version pinning strategy.
4. GitHub-hosted runner sandbox assumptions and limitations.
5. Required GitHub secrets and repository variables.
6. A staged execution path that produces the decision artifact, waits for `node scripts/agent-gatekeeper.js decision`, then implements.
7. A successful end-to-end dry run that does not expose credentials.

## Gemini provider status

Gemini is the preferred initial provider, but no Gemini API key, model identifier, free-tier assumption, or SDK behavior is committed here. Model selection remains configurable in `.agent/runtime/config.json` and should be overridden by repository variables only after current provider documentation is verified.

## External model data-processing warning

The input gate excludes and scans for obvious secrets before generated context is sent to any future model. Even after scanning, repository source and agent context sent to an external model provider are still external data processing and must be approved by maintainers.
