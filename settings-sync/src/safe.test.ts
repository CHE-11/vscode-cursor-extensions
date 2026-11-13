import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { writeInside } from './files';
import {
  apiBase,
  defaultLocalSettings,
  gistNameToUserPath,
  isExtensionId,
  isPlausibleToken,
  nameMatches,
  normalizeLocal,
  parseGistId,
  resolveUserFolder,
  sameHostHttps,
  workspaceFileTarget,
} from './safe';

const gistId = '0123456789abcdef0123456789abcdef';

test('gist file names stay inside the User folder', () => {
  const root = join(tmpdir(), 'settings-sync-user');
  assert.equal(gistNameToUserPath(root, 'snippets|foo.json'), resolve(root, 'snippets', 'foo.json'));
  assert.equal(gistNameToUserPath(root, 'settings.json'), resolve(root, 'settings.json'));
  assert.equal(gistNameToUserPath(root, '..|..|evil.json'), null);
  assert.equal(gistNameToUserPath(root, '..\\..\\evil.json'), null);
  assert.equal(gistNameToUserPath(root, 'snippets|..|secret.json'), null);
  assert.equal(gistNameToUserPath(root, 'syncLocalSettings.json'), null);
  assert.equal(gistNameToUserPath(root, '|customized_sync|notes.txt'), null);
});

test('a custom import only uses the file name inside the workspace', () => {
  const workspace = join(tmpdir(), 'workspace');
  assert.equal(workspaceFileTarget(workspace, '..|..|notes.txt'), resolve(workspace, 'notes.txt'));
  assert.equal(workspaceFileTarget(workspace, '.'), null);
  assert.equal(workspaceFileTarget(workspace, ''), null);
});

test('user folder resolution stays under the editor data directory', () => {
  const storage = join(tmpdir(), 'Cursor', 'User', 'globalStorage', 'che-11.ce-settings-sync');
  assert.equal(resolveUserFolder(storage, undefined), resolve(tmpdir(), 'Cursor', 'User'));
  const portable = join(tmpdir(), 'portable');
  assert.equal(resolveUserFolder(storage, portable), resolve(portable, 'user-data', 'User'));
  assert.throws(() => resolveUserFolder(join(tmpdir(), 'too-short'), undefined));
});

test('legacy tokens are removed from local settings and protected folders stay ignored', () => {
  const result = normalizeLocal({ token: ` ${'ghp_abcdefghijklmnop'} `, ignoreUploadFiles: ['extra.json'] });
  assert.equal(result.legacyToken, 'ghp_abcdefghijklmnop');
  assert.equal(result.changed, true);
  assert.equal(Object.hasOwn(result.settings, 'token'), false);
  assert.ok(result.settings.ignoreUploadFiles.includes('extra.json'));
  assert.ok(result.settings.ignoreUploadFolders.includes('globalStorage'));
  assert.ok(result.settings.ignoreUploadFolders.includes('History'));
  assert.deepEqual(normalizeLocal(undefined).settings.ignoreUploadFolders, defaultLocalSettings().ignoreUploadFolders);
});

test('tokens, gist ids, and extension ids reject injected values', () => {
  assert.equal(isPlausibleToken('ghp_abcdefghijklmnop'), true);
  assert.equal(isPlausibleToken('token\r\nAuthorization: x'), false);
  assert.equal(isPlausibleToken('short'), false);
  assert.equal(parseGistId(gistId), gistId);
  assert.equal(parseGistId(`https://gist.github.com/someone/${gistId}`), gistId);
  assert.equal(parseGistId('https://example.com/not-a-gist'), null);
  assert.equal(parseGistId('../gists/secret'), null);
  assert.equal(isExtensionId('che-11.ce-settings-sync'), true);
  assert.equal(isExtensionId('publisher.name'), true);
  assert.equal(isExtensionId('https://evil.example/extension.vsix'), false);
  assert.equal(isExtensionId('name-only'), false);
  assert.equal(nameMatches('state.vscdb', 'state.*'), true);
  assert.equal(nameMatches('settings.json', 'state.*'), false);
});

test('GitHub requests stay on the configured https host', () => {
  assert.equal(apiBase(''), 'https://api.github.com');
  assert.equal(apiBase('https://github.example.com'), 'https://github.example.com/api/v3');
  assert.throws(() => apiBase('http://github.example.com'));
  assert.throws(() => apiBase('https://user:secret@github.example.com'));
  const from = 'https://api.github.com/gists/1';
  assert.equal(sameHostHttps(from, '/gists/2'), 'https://api.github.com/gists/2');
  assert.equal(sameHostHttps(from, 'https://evil.example/gists/2'), null);
  assert.equal(sameHostHttps(from, 'http://api.github.com/gists/2'), null);
});

test('writes cannot leave the User folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'settings-sync-write-'));
  try {
    await writeInside(root, join(root, 'snippets', 'foo.json'), '{}\n');
    assert.equal(await readFile(join(root, 'snippets', 'foo.json'), 'utf8'), '{}\n');
    await assert.rejects(() => writeInside(root, resolve(root, '..', 'evil.json'), 'nope'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
