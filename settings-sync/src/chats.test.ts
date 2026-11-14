import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CHAT_COUNT,
  chunkChatRecords,
  exportChats,
  importChats,
  isChatChunkName,
  matchWorkspace,
  mergeChatTabs,
  mergeComposerData,
  MESSAGE_COUNT,
  normalizeFolder,
  remapHeaderValue,
  selectByBudget,
  trimComposerMessages,
  type ChatRecord,
} from './chats';
import { downloadTarget } from './files';

const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
    close(): void;
  };
};

const NEWER = '11111111-1111-4111-8111-111111111111';
const OLDER = '22222222-2222-4222-8222-222222222222';
const CHILD = '33333333-3333-4333-8333-333333333333';
const LOCAL = '44444444-4444-4444-8444-444444444444';

const SCHEMA = `
CREATE TABLE composerHeaders (
  composerId TEXT PRIMARY KEY,
  workspaceId TEXT,
  createdAt INTEGER,
  lastUpdatedAt INTEGER,
  isArchived INTEGER,
  isSubagent INTEGER,
  recency INTEGER,
  checkpointAt INTEGER,
  value TEXT,
  subagentTypeName TEXT
);
CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
`;

test('chat gist files are not written into the User folder', () => {
  assert.equal(isChatChunkName('chats|000.json'), true);
  assert.equal(isChatChunkName('settings.json'), false);
  assert.equal(downloadTarget(join(tmpdir(), 'settings-sync-user'), 'chats|000.json', {}), null);
});

test('chunks stay under the file cap and a value over 1 MB is skipped', () => {
  const small = kv(NEWER, 'a', 'x'.repeat(40));
  const first = chunkChatRecords([small], 10_000, 1_000_000);
  const limit = Buffer.byteLength(first.files[0].content);
  const second = kv(OLDER, 'b', 'y'.repeat(40));
  const split = chunkChatRecords([small, second], limit, 1_000_000);
  assert.equal(split.files.length, 2);
  assert.equal(split.files[0].gistName, 'chats|000.json');
  assert.equal(split.files[1].gistName, 'chats|001.json');
  for (const file of split.files) assert.ok(Buffer.byteLength(file.content) <= limit);

  const huge = kv(NEWER, 'big', 'z'.repeat(1_000_001));
  const skipped = chunkChatRecords([huge], 900_000, 1_000_000);
  assert.equal(skipped.files.length, 0);
  assert.equal(skipped.skippedLarge, 1);
});

test('a chat keeps its last 5 messages and drops file snapshots', () => {
  const headers = Array.from({ length: 8 }, (_, index) => ({ bubbleId: `m${index}`, type: 1 }));
  const trimmed = trimComposerMessages(JSON.stringify({
    fullConversationHeadersOnly: headers,
    conversationMap: { m0: { text: 'old' }, m7: { text: 'new' } },
    originalFileStates: { file: 'snapshot' },
    codeBlockData: { file: 'cache' },
    subComposerIds: ['child'],
    name: 'Demo',
  }), 5);
  const parsed = JSON.parse(trimmed.json) as {
    fullConversationHeadersOnly: Array<{ bubbleId: string }>;
    conversationMap: Record<string, unknown>;
    originalFileStates?: unknown;
    codeBlockData?: unknown;
    subComposerIds: string[];
    name: string;
  };
  assert.deepEqual(parsed.fullConversationHeadersOnly.map((item) => item.bubbleId), ['m3', 'm4', 'm5', 'm6', 'm7']);
  assert.deepEqual(trimmed.bubbleIds, ['m3', 'm4', 'm5', 'm6', 'm7']);
  assert.deepEqual(Object.keys(parsed.conversationMap), ['m7']);
  assert.equal(parsed.originalFileStates, undefined);
  assert.equal(parsed.codeBlockData, undefined);
  assert.deepEqual(parsed.subComposerIds, ['child']);
  assert.equal(parsed.name, 'Demo');
});

test('the newest conversations that fit are kept whole', () => {
  const selected = selectByBudget([{ id: 'new', bytes: 5 }, { id: 'big', bytes: 6 }, { id: 'old', bytes: 3 }], 8);
  assert.deepEqual(selected.selected.map((item) => item.id), ['new', 'old']);
  assert.equal(selected.omitted, 1);
});

test('workspace ids remap from a folder URI, then a unique folder name', () => {
  assert.equal(normalizeFolder('file:///c%3A/Users/Connor/proj'), 'c:/users/connor/proj');
  assert.equal(normalizeFolder('C:\\Users\\Connor\\proj'), 'c:/users/connor/proj');
  const exact = matchWorkspace(['C:\\Work\\demo'], [
    { id: 'abc123', folder: 'file:///C:/Work/demo' },
    { id: 'other', folder: 'file:///D:/Work/other' },
  ]);
  assert.equal(exact?.id, 'abc123');

  const byName = remapHeaderValue(headerJson('D:\\elsewhere\\demo', 'oldhash'), 'oldhash', [
    { id: 'local1', folder: 'file:///C:/repos/demo' },
  ]);
  assert.equal(byName.workspaceId, 'local1');
  assert.equal(JSON.parse(byName.value).workspaceIdentifier.id, 'local1');

  const ambiguous = remapHeaderValue(headerJson('D:\\elsewhere\\demo', 'oldhash'), 'oldhash', [
    { id: 'one', folder: 'file:///C:/a/demo' },
    { id: 'two', folder: 'file:///C:/b/demo' },
  ]);
  assert.equal(ambiguous.workspaceId, 'oldhash');
});

test('legacy chat documents merge by id and keep the newer copy', () => {
  const local = JSON.stringify({ allComposers: [{ composerId: 'local', lastUpdatedAt: 5, text: 'stay' }, { composerId: 'both', lastUpdatedAt: 9, text: 'local' }] });
  const remote = JSON.stringify({ allComposers: [{ composerId: 'both', lastUpdatedAt: 4, text: 'old' }, { composerId: 'remote', lastUpdatedAt: 8, text: 'add' }] });
  const merged = JSON.parse(mergeComposerData(local, remote)) as { allComposers: Array<{ composerId: string; text: string }> };
  assert.deepEqual(merged.allComposers.map((item) => item.text), ['stay', 'local', 'add']);

  const tabs = JSON.parse(mergeChatTabs(
    JSON.stringify({ tabs: [{ tabId: 't', lastSendTime: 2, title: 'old' }] }),
    JSON.stringify({ tabs: [{ id: 't', timestamp: 5, title: 'new' }, { id: 'n', timestamp: 1, title: 'extra' }] })
  )) as { tabs: Array<{ title: string }> };
  assert.deepEqual(tabs.tabs.map((tab) => tab.title), ['new', 'extra']);
});

test('export and import round-trip the newest chats and remap the workspace', async () => {
  const source = tempUser();
  const sourceDb = openGlobal(source);
  insertComposer(sourceDb, NEWER, 30, { bubble: 'newest', subagents: [CHILD] });
  insertComposer(sourceDb, CHILD, 28, { bubble: 'child', subagent: true });
  insertComposer(sourceDb, OLDER, 10, { bubble: 'x'.repeat(100_000) });
  sourceDb.close();

  const exported = await exportChats(source, { budgetBytes: 50_000, fileBytes: 900_000, valueBytes: 1_000_000 });
  const payload = exported.files.map((file) => file.content).join('\n');
  assert.equal(exported.preserve, false);
  assert.ok(payload.includes(NEWER));
  assert.ok(payload.includes(CHILD));
  assert.equal(payload.includes(OLDER), false);
  assert.ok(exported.omitted >= 1);

  const target = tempUser();
  writeWorkspace(target, 'abc123', 'file:///C:/Work/demo');
  const targetDb = openGlobal(target);
  insertComposer(targetDb, LOCAL, 4, { bubble: 'keep-me' });
  insertComposer(targetDb, NEWER, 1, { bubble: 'stale' });
  targetDb.close();

  const files = Object.fromEntries(exported.files.map((file) => [file.gistName, file.content]));
  const imported = await importChats(target, files);
  assert.ok(imported.applied >= 2);
  assert.equal(imported.reload, true);

  const check = openGlobal(target);
  const newer = check.prepare('SELECT workspaceId, value, lastUpdatedAt FROM composerHeaders WHERE composerId = ?').get(NEWER) as {
    workspaceId: string;
    value: string;
    lastUpdatedAt: number;
  };
  assert.equal(newer.workspaceId, 'abc123');
  assert.equal(JSON.parse(newer.value).workspaceIdentifier.id, 'abc123');
  assert.equal(newer.lastUpdatedAt, 30);
  const bubbles = check.prepare('SELECT value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key').all(`bubbleId:${NEWER}:%`) as Array<{ value: string }>;
  assert.deepEqual(bubbles.map((row) => row.value), ['newest']);
  assert.equal((check.prepare('SELECT composerId FROM composerHeaders WHERE composerId = ?').get(CHILD) as { composerId: string }).composerId, CHILD);
  assert.equal((check.prepare('SELECT composerId FROM composerHeaders WHERE composerId = ?').get(LOCAL) as { composerId: string }).composerId, LOCAL);
  assert.equal(check.prepare('SELECT composerId FROM composerHeaders WHERE composerId = ?').get(OLDER), undefined);
  check.close();
  rmSync(source, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

test('a newer local chat is kept and a gist cannot write other database keys', async () => {
  const folder = tempUser();
  const db = openGlobal(folder);
  insertComposer(db, NEWER, 50, { bubble: 'local-copy' });
  db.close();
  const files = {
    'chats|000.json': JSON.stringify({
      v: 1,
      records: [
        { kind: 'header', complete: true, header: storedHeader(NEWER, 10) },
        { kind: 'kv', composerId: NEWER, key: `agentKv:blob:nope`, value: 'secret' },
        { kind: 'kv', composerId: NEWER, key: `bubbleId:${NEWER}:new`, value: 'remote-copy' },
      ],
    }),
  };
  const imported = await importChats(folder, files);
  assert.equal(imported.kept, 1);
  const check = openGlobal(folder);
  const bubble = check.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(`bubbleId:${NEWER}:1`) as { value: string };
  assert.equal(bubble.value, 'local-copy');
  assert.equal(check.prepare('SELECT key FROM cursorDiskKV WHERE key = ?').get('agentKv:blob:nope'), undefined);
  check.close();
  rmSync(folder, { recursive: true, force: true });
});

test('export keeps the last 30 messages of the 15 newest chats', async () => {
  const folder = tempUser();
  const db = openGlobal(folder);
  const messageCount = 32;
  for (let index = 1; index <= 16; index += 1) {
    const bubbles = Array.from({ length: messageCount }, (_, message) => ({
      id: `m${message}`,
      value: JSON.stringify({ text: `m${message}` }),
    }));
    insertComposer(db, composerId(index), index, {
      bubbles,
      composer: {
        fullConversationHeadersOnly: bubbles.map((bubble) => ({ bubbleId: bubble.id, type: 1 })),
        originalFileStates: { file: 'snapshot' },
        name: `chat-${index}`,
      },
    });
  }
  db.close();

  const exported = await exportChats(folder, { budgetBytes: 8_000_000, fileBytes: 900_000, valueBytes: 1_000_000 });
  const records = exported.files.flatMap((file) => (JSON.parse(file.content) as { records: ChatRecord[] }).records);
  const ids = records.flatMap((record) => (record.kind === 'header' ? [record.header.composerId] : []));
  assert.deepEqual(ids, Array.from({ length: 15 }, (_, index) => composerId(16 - index)));
  assert.equal(exported.synced, 15);
  assert.equal(exported.omitted, 1);

  const newest = composerId(16);
  const keptIds = Array.from({ length: 30 }, (_, index) => `m${index + 2}`);
  const bubbleKeys = records.flatMap((record) => (
    record.kind === 'kv' && record.key.startsWith(`bubbleId:${newest}:`) ? [record.key.split(':').at(-1)] : []
  ));
  assert.deepEqual(bubbleKeys, keptIds);
  const composer = records.find((record) => record.kind === 'kv' && record.key === `composerData:${newest}`);
  assert.equal(composer?.kind, 'kv');
  if (composer?.kind === 'kv') {
    const parsed = JSON.parse(composer.value) as { originalFileStates?: unknown; fullConversationHeadersOnly: Array<{ bubbleId: string }> };
    assert.equal(parsed.originalFileStates, undefined);
    assert.deepEqual(parsed.fullConversationHeadersOnly.map((item) => item.bubbleId), keptIds);
  }
  rmSync(folder, { recursive: true, force: true });
});

test('messages without a conversation list keep the latest 30 by time', async () => {
  const folder = tempUser();
  const db = openGlobal(folder);
  const times = Array.from({ length: 32 }, (_, index) => ({ id: `m${index}`, createdAt: index + 1 }));
  insertComposer(db, NEWER, 5, {
    bubbles: times.map((item) => ({ id: item.id, value: JSON.stringify({ createdAt: item.createdAt }) })),
  });
  db.close();

  const exported = await exportChats(folder, { budgetBytes: 8_000_000, fileBytes: 900_000, valueBytes: 1_000_000 });
  const records = exported.files.flatMap((file) => (JSON.parse(file.content) as { records: ChatRecord[] }).records);
  const bubbleKeys = records.flatMap((record) => (
    record.kind === 'kv' && record.key.startsWith(`bubbleId:${NEWER}:`) ? [record.key.split(':').at(-1)] : []
  ));
  assert.deepEqual(bubbleKeys, times.slice(2).map((item) => item.id));
  rmSync(folder, { recursive: true, force: true });
});

test('legacy workspace chats merge into the matching workspace database', async () => {
  const folder = tempUser();
  writeWorkspace(folder, 'abc123', 'file:///C:/Work/demo');
  const globalDb = openGlobal(folder);
  globalDb.close();
  const workspaceDb = openDb(join(folder, 'workspaceStorage', 'abc123', 'state.vscdb'));
  workspaceDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
    'composer.composerData',
    JSON.stringify({ allComposers: [{ composerId: 'both', lastUpdatedAt: 9, text: 'local' }] })
  );
  workspaceDb.close();

  const remote = JSON.stringify({ allComposers: [{ composerId: 'both', lastUpdatedAt: 4, text: 'old' }, { composerId: 'remote', lastUpdatedAt: 8, text: 'add' }] });
  const imported = await importChats(folder, {
    'chats|000.json': JSON.stringify({
      v: 1,
      records: [{ kind: 'legacy', folder: 'file:///C:/Work/demo', legacyKey: 'composer.composerData', value: remote }],
    }),
  });
  assert.equal(imported.applied, 1);
  const check = openDb(join(folder, 'workspaceStorage', 'abc123', 'state.vscdb'));
  const row = check.prepare('SELECT value FROM ItemTable WHERE key = ?').get('composer.composerData') as { value: string };
  const composers = JSON.parse(row.value).allComposers as Array<{ text: string }>;
  assert.deepEqual(composers.map((item) => item.text), ['local', 'add']);
  check.close();
  rmSync(folder, { recursive: true, force: true });
});

function kv(composerId: string, bubbleId: string, value: string): ChatRecord {
  return { kind: 'kv', composerId, key: `bubbleId:${composerId}:${bubbleId}`, value };
}

function headerJson(fsPath: string, id: string): string {
  return JSON.stringify({
    name: 'Demo',
    workspaceIdentifier: {
      id,
      uri: { fsPath, external: 'file:///C:/Work/demo', path: '/C:/Work/demo', scheme: 'file' },
    },
  });
}

function storedHeader(composerId: string, lastUpdatedAt: number) {
  return {
    composerId,
    workspaceId: 'oldhash',
    createdAt: 1,
    lastUpdatedAt,
    isArchived: 0,
    isSubagent: 0,
    recency: 0,
    checkpointAt: null,
    value: headerJson('C:\\Work\\demo', 'oldhash'),
    subagentTypeName: null,
  };
}

function tempUser(): string {
  return mkdtempSync(join(tmpdir(), 'ce-settings-sync-chats-'));
}

function openGlobal(userFolder: string) {
  return openDb(join(userFolder, 'globalStorage', 'state.vscdb'));
}

function openDb(path: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  const existing = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'composerHeaders'`).get() as { name?: string } | undefined;
  if (!existing) db.exec(SCHEMA);
  return db;
}

function writeWorkspace(userFolder: string, id: string, folder: string): void {
  const directory = join(userFolder, 'workspaceStorage', id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'workspace.json'), JSON.stringify({ folder }));
}

function composerId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function insertComposer(
  db: ReturnType<typeof openDb>,
  composerId: string,
  lastUpdatedAt: number,
  options: {
    bubble?: string;
    bubbles?: Array<{ id: string; value: string }>;
    subagent?: boolean;
    subagents?: string[];
    composer?: Record<string, unknown>;
  } = {}
): void {
  db.prepare(`INSERT INTO composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, value, subagentTypeName)
    VALUES (?, 'oldhash', 1, ?, 0, ?, 0, NULL, ?, NULL)`).run(
    composerId,
    lastUpdatedAt,
    options.subagent ? 1 : 0,
    headerJson('C:\\Work\\demo', 'oldhash')
  );
  db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
    `composerData:${composerId}`,
    JSON.stringify({ subComposerIds: options.subagents ?? [], ...options.composer })
  );
  const bubbles = options.bubbles ?? [{ id: '1', value: options.bubble ?? '' }];
  for (const bubble of bubbles) {
    db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(`bubbleId:${composerId}:${bubble.id}`, bubble.value);
  }
}
