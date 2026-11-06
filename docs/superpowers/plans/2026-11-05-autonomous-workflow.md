# Autonomous job-agent implementation

> Execution: native implementation in the current isolated worktree. User's instruction to improve all findings authorizes routine design choices. The review report and design above are the spec; no further selection gate is needed.

## Files and responsibilities

- src/lib/intake.mjs: canonical-job validation and atomic-batch normalization.
- src/lib/package-paths.mjs: contained application paths and symlink checks.
- src/lib/policy.mjs: effective-policy validation.
- src/lib/workspace.mjs: readiness, package inspection and resume resolution.
- src/lib/authorization.mjs: session planning, serialized/journaled commit and conservative recovery using injected existing store operations.
- src/lib/follow-ups.mjs: scheduling and due/completion semantics.
- src/pipeline/select.mjs: deterministic scored-job selection.
- Existing config/store/auto/gate/CLI/hooks: integrate ownership without a second state or authorization mechanism.
- tests/*: behavior tests at the module/CLI/hook interfaces.
- Agent commands and docs: consume deterministic results and explain new recovery/next-work behavior.

## Review Focus

Malformed rows must not partly persist. Existing path links must not escape package roots. Invalid numeric config must not turn comparisons into NaN. Failed/expired authorization must never create or preserve browser permission. Batch usage must never be automatically refunded. Repeated selection/drafting/completion must not duplicate work. Read-only status must not authorize or mutate candidate data.

### Task 1: Intake and policy
- RED: add traversal, URL/type, whole-batch and malformed policy tests; run the focused test files.
- GREEN: implement assertCanonicalJob(job), normalizeManualBatch(entries), applicationPath(dir), validatePolicy(policy), and wire config/store/CLI.
- Verify: focused tests and npm test; commit and push.

### Task 2: Workspace and next-work
- RED: add relocated readiness, placeholder/auto-mode, PDF precedence and scored/capped-rerun tests.
- GREEN: implement inspectWorkspace(), inspectPackage(app), resolveResume(app), selectForTailoring(profile, policy, {limit}), expose workspace and select commands, and integrate doctor/first-run/audit/auto.
- Verify: focused tests and npm test; commit and push.

### Task 3: Authorization and gate
- RED: add invalid URL, partial-write, expiry/reapproval, active session replacement, recovery journal, lock contention and raw hook failure regressions.
- GREEN: validate before writes; serialize/journal approval/arming/revocation/disarming and recover fail-closed. Classify verified browser operations, keep independent shell denial before context reads, deny unclassified executable operations.
- Verify: focused tests, mutation sensitivity and npm test; commit and push.

### Task 4: Follow-ups and orchestration
- RED: add due/closed/confirmed-completion/idempotent draft tests.
- GREEN: add follow-up-draft and follow-up-complete CLI operations; share follow-up read semantics between status/tracker; agent commands consume workspace/select/recover and deterministic output. Update setup native failure handling and docs.
- Verify: focused CLI workflow and hook checks, full suite, complexity analyzer and fresh whole-branch review. Repair material findings, commit and push.

### Task 5: Delivery
- Record exact checks, responsibilities, analyzer results, assumptions and remaining UNKNOWNs.
- Open a ready PR, link it immediately, read it back, leave unmerged.

## Completion record

- Task 1 complete: intake and effective-policy validation, commit `86e625d`.
- Tasks 2–3 complete: workspace/selection and serialized authorization/recovery,
  commit `25a920f`, followed by integration in `4f7d4f9`.
- Task 4 complete: follow-ups, agent orchestration, tooling and docs in `4f7d4f9`;
  eight final-review findings repaired in `d6a1785`, with 95 tests passing.
- Task 5 complete: ready PR #1 linked and read back; evidence, exact code
  snapshot, responsibilities, decisions and UNKNOWNs recorded in
  [verification](../../verification/2026-11-05-autonomous-workflow.md).
- No task dropped. Merge, deployment and live submission are outside authorization.

