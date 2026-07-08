# Phase 2C.2 Test Plan

1. Verify the runtime adapter parses with `node --check scripts/agent-runtime-adapter.js`.
2. Run `node scripts/agent-runtime-adapter.delta-budget.test.js`.
3. Merge only after the pull-request contract check passes.
4. Manually dispatch Autonomous Evolution Agent.
5. Confirm the generated implementation task contains the hard delta budget.
6. Confirm the implementation either stays below the configured line ceiling or reports a blocked outcome.
7. Confirm the deterministic Diff Gate remains the final authority.
