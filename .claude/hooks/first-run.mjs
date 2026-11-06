#!/usr/bin/env node
// Read-only readiness inspection shares the CLI's workspace facts.
import { inspectWorkspace } from '../../src/lib/workspace.mjs';

try {
  const state = inspectWorkspace();
  if (!state.ready) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [
        'claude-job-agent: this workspace is not ready for its owner.',
        ...state.blockers,
        'Offer /setup to resolve these items before running the pipeline.',
        'Run jobagent workspace --json for resolved paths; optional achievements do not block readiness.',
      ].join('\n'),
    } }));
  }
} catch {
  process.stdout.write('claude-job-agent: readiness could not be inspected; run /doctor before the pipeline.');
}
