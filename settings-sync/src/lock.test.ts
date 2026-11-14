import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { processIsRunning, tryLock } from './lock';

test('the current process counts as running and a missing pid does not', () => {
  assert.equal(processIsRunning(process.pid), true);
  assert.equal(processIsRunning(0), false);
  assert.equal(processIsRunning(-1), false);
  assert.equal(processIsRunning(Number.NaN), false);
});

test('a lock whose process is gone does not block the next run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-sync-lock-'));
  const lockPath = join(dir, 'sync.lock');
  try {
    await writeFile(lockPath, '99999999', 'utf8');
    let ran = false;
    const outcome = await tryLock(lockPath, async () => {
      ran = true;
    });
    assert.equal(outcome.busy, false);
    assert.equal(ran, true);
    await assert.rejects(() => stat(lockPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a lock held by this process is busy until it finishes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-sync-lock-'));
  const lockPath = join(dir, 'sync.lock');
  try {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = tryLock(lockPath, () => gate);
    await waitForLock(lockPath);
    const second = await tryLock(lockPath, async () => undefined);
    assert.equal(second.busy, true);
    release();
    const finished = await first;
    assert.equal(finished.busy, false);
    await assert.rejects(() => stat(lockPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitForLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const info = await stat(lockPath);
      if (info.isFile() && info.size > 0) return;
    } catch {
      // The lock file is not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The lock file was not created.');
}
