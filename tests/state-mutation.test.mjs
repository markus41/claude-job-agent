import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { beforeEach, test } from 'node:test';
import { paths } from '../src/lib/config.mjs';
import { stateMutation } from '../src/lib/state-mutation.mjs';

beforeEach(() => { process.env.JOBAGENT_HOME = mkdtempSync(join(tmpdir(), 'jobagent-lock-')); });

test('dead legacy lock and reclamation owners cannot strand new mutations', () => {
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(dead.status, 0);
  const p = paths(); mkdirSync(p.stateDir, { recursive: true });
  const owner = JSON.stringify({ pid: Number(dead.stdout), nonce: 'dead-owner' });
  writeFileSync(join(p.stateDir, 'state.lock'), owner);
  writeFileSync(join(p.stateDir, 'state.lock.reclaim'), owner);
  assert.equal(stateMutation(() => 'completed')(), 'completed');
});

test('concurrent processes never enter the mutation together', { timeout: 15_000 }, async (t) => {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lib/state-mutation.mjs')).href;
  const marker = join(paths().root, 'exclusive-marker');
  const source = `
    import { stateMutation } from ${JSON.stringify(moduleUrl)};
    import { writeFileSync, readSync, rmSync } from 'node:fs';
    process.once('message', () => {
      try {
        stateMutation(() => {
          writeFileSync(${JSON.stringify(marker)}, '', {flag:'wx'});
          process.send({type:'entered'});
          readSync(0, Buffer.alloc(1), 0, 1, null);
          rmSync(${JSON.stringify(marker)});
        })();
        process.send({type:'result', ok:true});
      } catch (error) { process.send({type:'result', error:error.message}); }
      process.disconnect();
    });
    process.send({type:'ready'});
  `;
  const contenders = Array.from({ length: 6 }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let ready, first, result;
    const state = { child, ready: new Promise((r) => { ready = r; }), first: new Promise((r) => { first = r; }), result: new Promise((r) => { result = r; }) };
    child.on('message', (message) => {
      if (message.type === 'ready') ready();
      else if (message.type === 'entered') { state.entered = true; first(); }
      else if (message.type === 'result') { state.outcome = message; first(); result(message); }
    });
    return state;
  });
  await Promise.all(contenders.map((c) => c.ready));
  for (const contender of contenders) contender.child.send('start');
  await Promise.all(contenders.map((c) => c.first));
  assert.ok(contenders.filter((c) => c.entered).length <= 1, 'only one process may enter');
  for (const contender of contenders) if (contender.entered) contender.child.stdin.write('x');
  const outcomes = await Promise.all(contenders.map((c) => c.result));
  for (const outcome of outcomes) if (outcome.error) assert.match(outcome.error, /busy|locked/i);
  assert.equal(stateMutation(() => 'completed')(), 'completed');
});

test('killed choosing and published intent owners do not block later writers', { timeout: 10_000 }, async (t) => {
  const directory = join(paths().stateDir, 'writers'); mkdirSync(directory, { recursive: true });
  for (const ticket of [null, 1]) {
    const source = `
      import {writeFileSync} from 'node:fs';
      import {join} from 'node:path';
      writeFileSync(join(${JSON.stringify(directory)}, process.pid + '-crashed.json'), ${JSON.stringify(ticket === null ? '{' : JSON.stringify({ choosing: false, ticket: 1 }))});
      process.on('message', () => {}); process.send('ready');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    await once(child, 'message');
    const exited = once(child, 'exit'); child.kill(); await exited;
    assert.equal(stateMutation(() => 'completed')(), 'completed');
  }
});

test('an unreadable live writer intent fails closed', () => {
  const directory = join(paths().stateDir, 'writers'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, process.pid + '-other.json'), '{');
  assert.throws(() => stateMutation(() => 'must not enter')(), /busy|locked/i);
});
