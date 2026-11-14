import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BUNDLE_NAME, BundleFormatError, folderIsSafe, readBundle, writeBundle } from './folder';

test('a folder bundle round-trips and replaces the previous file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-sync-folder-'));
  try {
    await writeBundle(dir, {
      'settings.json': { content: '{}\n' },
      cloudSettings: { content: '{"lastUpload":"2020-01-01T00:00:00.000Z"}' },
      'removed.json': null,
    });
    await writeBundle(dir, {
      'settings.json': { content: '{"editor.fontSize":14}\n' },
      cloudSettings: { content: '{"lastUpload":"2020-01-02T00:00:00.000Z"}' },
    });
    const remote = await readBundle(dir);
    assert.equal(remote.files['settings.json'].content, '{"editor.fontSize":14}\n');
    assert.equal(remote.files.cloudSettings.content, '{"lastUpload":"2020-01-02T00:00:00.000Z"}');
    assert.equal(remote.files['removed.json'], undefined);
    assert.deepEqual(await readdir(dir), [BUNDLE_NAME]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing bundle is an empty snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-sync-folder-'));
  try {
    const remote = await readBundle(dir);
    assert.equal(remote.id, dir);
    assert.deepEqual(remote.files, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid bundle JSON is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settings-sync-folder-'));
  try {
    await writeFile(join(dir, BUNDLE_NAME), '{', 'utf8');
    await assert.rejects(() => readBundle(dir), BundleFormatError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the sync folder cannot be the User folder, inside it, or a parent of it', () => {
  const root = join(tmpdir(), 'settings-sync-safe');
  const user = join(root, 'User');
  assert.equal(folderIsSafe(user, user), false);
  assert.equal(folderIsSafe(user, join(user, 'snippets')), false);
  assert.equal(folderIsSafe(user, root), false);
  assert.equal(folderIsSafe(user, join(tmpdir(), 'Mega')), true);
  assert.equal(folderIsSafe(user, 'relative'), false);
  assert.equal(folderIsSafe(user, ''), false);
  if (process.platform === 'win32') assert.equal(folderIsSafe(user, user.toUpperCase()), false);
});
