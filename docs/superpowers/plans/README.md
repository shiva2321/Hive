# Hive Remediation Plans — Execution Order

Three independent implementation plans came out of [`docs/AUDIT_REPORT_2026-09-19.md`](../AUDIT_REPORT_2026-09-19.md). Each is self-contained — written assuming the executing agent has zero prior context on this conversation, only the repo itself.

**Run them in this order:**

1. **[2026-09-19-intelligence-layer-rewire.md](2026-09-19-intelligence-layer-rewire.md)** — fixes `npm test` (currently failing), replaces the fabricated HiveBrain, wires the dormant LLM extractor into real ingestion.
2. **[2026-09-19-security-persistence-truth.md](2026-09-19-security-persistence-truth.md)** — Task 2's own verification step (Step 8) runs `npm test` and expects it to pass, which requires Plan 1's Task 1 to already be done. Do Plan 1 first.
3. **[2026-09-19-ingestion-completeness.md](2026-09-19-ingestion-completeness.md)** — no dependency on the other two; can run any time, but sequenced last here since it's the least urgent of the three (a completeness gap, not a false claim or a broken test).

## For whoever executes these

- Each plan's tasks end in a real `git commit`. Commit after every task, not just at the end — that's what makes "we will examine them" (the human review step after this) actually reviewable incrementally, rather than one enormous diff.
- Every verification step has a concrete command and an expected output. If actual output doesn't match, stop and fix before moving to the next step — don't mark a task done on code-review alone, especially Task 3 of the ingestion-completeness plan, which needs a real logged-in Gemini session to verify and cannot be confirmed by reading the code.
- Each plan ends with an "Explicitly out of scope" section. That's not unfinished work hiding — it's this audit being honest about what it did and didn't cover, so nothing gets silently dropped between here and the next round.
- If a plan's assumptions about the current code don't match what you actually find (line numbers shifted, a file's content differs from what a step quotes), stop and reconcile before proceeding — don't guess.

## After each plan

Report back per-task: which steps completed clean, which needed deviation and why, and the real output of every verification command — especially the manual/exploratory ones (Task 1 and Task 3 of the ingestion-completeness plan) that can't be confirmed by code review alone.
