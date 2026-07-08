# Phase 2C.2 — Autonomous Delta Containment

The implementation runtime receives the deterministic Diff Gate line-change ceiling before coding.

The task contract requires the smallest viable patch, preservation of existing formatting, and avoidance of unrelated rewrites, generated assets, and lockfile churn. The implementation runtime must inspect `git diff --numstat` before reporting success. If the approved improvement cannot fit safely inside the configured line budget, it must report a blocked outcome instead of forcing an oversized patch.

The Diff Gate remains authoritative and its default 500-line ceiling is unchanged.
