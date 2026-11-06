# Autonomous job-agent improvements

The job workflow should advance from discovery to human review and through an already authorized batch with less model bookkeeping. Implement all seven reviewed opportunities using the existing Node 22+ modules, local JSON and zero runtime dependencies.

## Behavior and ownership

- Job intake owns canonical job validation and all-or-nothing manual batches. Package creation independently validates directory containment, including existing symbolic links. Reject unsafe identifiers and non-HTTP(S) apply URLs before writing.
- Effective policy owns types, finite numeric ranges, enum values and scoring weights after merging defaults. Invalid settings fail closed; manual and documented auto modes remain supported.
- Authorization owns a coherent application/session/batch lifecycle. Validate before writes, serialize authorization mutations with a local lock, and journal incomplete commits so recovery only revokes stale permission and restores queued state. Consumed batch slots are conservative and never refunded automatically. A live session cannot be silently replaced. Expiry requeues the application before a newly human-authorized approval or agent auto-arm under a valid batch. Recovery never creates permission.
- Submission-tool interpretation keeps human-only command denial independent from context loading. Verify supported Playwright operation names from its installed package source before changing classification. Arbitrary script execution and unknown browser operations are refused; safe snapshots and normal form operations remain usable. The gate stays project-scoped.
- Deterministic scored-job selection provides capped, ranked, unpackaged jobs to hunt/tailor. Existing hard filters remain active. Models score fit and write truthful material.
- Workspace inspection centralizes resource paths, placeholder detection, optional files, and tailored/master/uploaded resume precedence. Hooks honor JOBAGENT_HOME. Doctor supports both modes; Windows bootstrap checks native command results. Read-only inspection reports recovery needs; explicit lifecycle commands perform recovery.
- Follow-up tracking centralizes due/next semantics and provides idempotent draft and human-confirmed completion records. Drafting never marks a note sent. No message is sent externally.

## Decisions made for Markus

Keep manual authorization as the default. Do not enable auto mode, authorize applications, run live discovery, or submit anything. Keep blocked applications visible with reasons; autonomous work skips blockers without guessing. Use the existing isolated review branch. Implement locally and open a ready PR; leave it unmerged. No production/candidate files are read or changed.

## Verification

Builder-check decisions: a pending authorization journal locks the browser; session publication is last. All application-ledger mutations use the same lock. Auto sessions expire no later than their attestation. Selection orders strong before good, then descending score, then job id, and excludes active same-job or same-company/title-family packages. Terminal withdrawn/rejected/closed applications do not block retry. Follow-up identity is (application, due date); drafts and explicitly human-confirmed completion remain distinct, preserving legacy completed date strings.

First reproduce defects in focused regressions, then repair. Exercise malformed batches/policy, containment, interrupted authorization and expiry, raw hook failures, ranked reruns, workspace relocation and resume precedence, and idempotent follow-ups. Run the full repository suite and analyzer-measured cognitive complexity <=15 for changed shared functions. Capture evidence and a fresh whole-diff review. Live ATS, actual submission, native Excel, and provider login remain outside the proof.

