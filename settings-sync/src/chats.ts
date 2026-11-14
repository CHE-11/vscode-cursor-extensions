import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const nodeRequire = createRequire(__filename);

export const CHAT_PREFIX = 'chats|';
export const CHAT_BUDGET_BYTES = 8_000_000;
export const CHAT_FILE_BYTES = 900_000;
export const CHAT_VALUE_BYTES = 1_000_000;
export const CHAT_COUNT = 10;
export const MESSAGE_COUNT = 5;
const CHAT_HARD_FILE_BYTES = 990_000;

const LEGACY_COMPOSER = 'composer.composerData';
const LEGACY_CHAT = 'workbench.panel.aichat.view.aichat.chatdata';
const COMPOSER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_ID = /^[A-Za-z0-9]+$/;

const HEADER_FIELDS = [
  'composerId',
  'workspaceId',
  'createdAt',
  'lastUpdatedAt',
  'isArchived',
  'isSubagent',
  'recency',
  'checkpointAt',
  'value',
  'subagentTypeName',
] as const;

type HeaderField = (typeof HEADER_FIELDS)[number];
type LegacyKey = typeof LEGACY_COMPOSER | typeof LEGACY_CHAT;

export interface ChatHeader {
  composerId: string;
  workspaceId: string | null;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  isArchived: number | null;
  isSubagent: number | null;
  recency: number | null;
  checkpointAt: number | null;
  value: string;
  subagentTypeName: string | null;
}

export type ChatRecord =
  | { kind: 'header'; header: ChatHeader; complete: boolean }
  | { kind: 'kv'; composerId: string; key: string; value: string }
  | { kind: 'legacy'; folder: string; legacyKey: LegacyKey; value: string };

export interface ChatFile {
  gistName: string;
  content: string;
}

export interface ChatLimits {
  budgetBytes: number;
  fileBytes: number;
  valueBytes: number;
  chatCount?: number;
  messageCount?: number;
}

export interface ChatExportResult {
  files: ChatFile[];
  preserve: boolean;
  notes: string[];
  synced: number;
  omitted: number;
  skippedLarge: number;
}

export interface ChatImportResult {
  applied: number;
  kept: number;
  notes: string[];
  reload: boolean;
}

export interface WorkspaceFolder {
  id: string;
  folder: string;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface Bundle {
  records: ChatRecord[];
  bytes: number;
}

const defaultLimits: ChatLimits = {
  budgetBytes: CHAT_BUDGET_BYTES,
  fileBytes: CHAT_FILE_BYTES,
  valueBytes: CHAT_VALUE_BYTES,
  chatCount: CHAT_COUNT,
  messageCount: MESSAGE_COUNT,
};

class SqliteMissing extends Error {
  constructor() {
    super('Chat sync needs the editor SQLite module (node:sqlite). Settings were still synced.');
  }
}

export function isChatChunkName(name: string): boolean {
  return name.startsWith(CHAT_PREFIX) && name.length > CHAT_PREFIX.length;
}

export function chatGistName(index: number): string {
  return `${CHAT_PREFIX}${index.toString().padStart(3, '0')}.json`;
}

export function remoteHeaderWins(localUpdated: number | null, remoteUpdated: number | null): boolean {
  if (remoteUpdated === null) return false;
  if (localUpdated === null) return true;
  return remoteUpdated > localUpdated;
}

export function normalizeFolder(value: string): string {
  let text = value.trim();
  if (/^file:/i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      text = text.replace(/^file:\/*/i, '');
    }
  }
  text = text.replace(/\\/g, '/');
  text = text.replace(/^\/([a-zA-Z]:)/, '$1');
  if (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1);
  return text.toLowerCase();
}

export function matchWorkspace(candidates: string[], workspaces: WorkspaceFolder[]): WorkspaceFolder | null {
  const normalized = candidates.map(normalizeFolder).filter(Boolean);
  for (const workspace of workspaces) {
    const folder = normalizeFolder(workspace.folder);
    if (folder && normalized.includes(folder)) return workspace;
  }
  const names = new Set(normalized.map(folderBasename).filter(Boolean));
  const byName = workspaces.filter((workspace) => names.has(folderBasename(normalizeFolder(workspace.folder))));
  return byName.length === 1 ? byName[0] : null;
}

export function remapHeaderValue(
  value: string,
  workspaceId: string | null,
  workspaces: WorkspaceFolder[]
): { workspaceId: string | null; value: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { workspaceId, value };
  }
  if (!parsed || typeof parsed !== 'object') return { workspaceId, value };
  const record = parsed as Record<string, unknown>;
  const identifier = record.workspaceIdentifier;
  const match = matchWorkspace(folderCandidates(identifier), workspaces);
  if (!match) return { workspaceId, value };
  if (identifier && typeof identifier === 'object') {
    (identifier as Record<string, unknown>).id = match.id;
  }
  return { workspaceId: match.id, value: JSON.stringify(record) };
}

export function mergeComposerData(localJson: string | null, remoteJson: string): string {
  return mergeCollection(localJson, remoteJson, 'allComposers', composerIdentity, composerTime);
}

export function mergeChatTabs(localJson: string | null, remoteJson: string): string {
  return mergeCollection(localJson, remoteJson, 'tabs', tabIdentity, tabTime);
}

export function trimComposerMessages(composerJson: string, messageLimit: number): { json: string; bubbleIds: string[] | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(composerJson);
  } catch {
    return { json: composerJson, bubbleIds: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { json: composerJson, bubbleIds: null };
  const record = parsed as Record<string, unknown>;
  let bubbleIds: string[] | null = null;
  if (Array.isArray(record.fullConversationHeadersOnly)) {
    const kept = messageLimit <= 0 ? [] : record.fullConversationHeadersOnly.filter(isBubbleHeader).slice(-messageLimit);
    record.fullConversationHeadersOnly = kept;
    bubbleIds = kept.map((item) => item.bubbleId);
    if (record.conversationMap && typeof record.conversationMap === 'object' && !Array.isArray(record.conversationMap)) {
      const map = record.conversationMap as Record<string, unknown>;
      for (const key of Object.keys(map)) {
        if (!bubbleIds.includes(key)) delete map[key];
      }
    }
  }
  delete record.originalFileStates;
  delete record.codeBlockData;
  return { json: JSON.stringify(record), bubbleIds };
}

export function selectByBudget<T extends { bytes: number }>(items: T[], budget: number): { selected: T[]; omitted: number } {
  const selected: T[] = [];
  let used = 0;
  let omitted = 0;
  for (const item of items) {
    if (item.bytes > budget || used + item.bytes > budget) {
      omitted += 1;
      continue;
    }
    selected.push(item);
    used += item.bytes;
  }
  return { selected, omitted };
}

export function chunkChatRecords(
  records: ChatRecord[],
  fileBytes: number,
  valueBytes: number
): { files: ChatFile[]; skippedLarge: number } {
  const hardFileBytes = Math.min(valueBytes, CHAT_HARD_FILE_BYTES);
  const accepted: ChatRecord[] = [];
  let skippedLarge = 0;
  for (const record of records) {
    if (recordValueBytes(record) > valueBytes) {
      skippedLarge += 1;
      continue;
    }
    accepted.push(record);
  }

  const contents: string[] = [];
  let batch: ChatRecord[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    contents.push(fileContent(batch));
    batch = [];
  };

  for (const record of accepted) {
    const alone = fileContent([record]);
    const aloneBytes = Buffer.byteLength(alone);
    if (aloneBytes > hardFileBytes) {
      skippedLarge += 1;
      continue;
    }
    if (aloneBytes > fileBytes) {
      flush();
      contents.push(alone);
      continue;
    }
    if (batch.length > 0 && Buffer.byteLength(fileContent([...batch, record])) > fileBytes) flush();
    batch.push(record);
  }
  flush();

  return {
    files: contents.map((content, index) => ({ gistName: chatGistName(index), content })),
    skippedLarge,
  };
}

export async function exportChats(userFolder: string, limits: ChatLimits = defaultLimits): Promise<ChatExportResult> {
  try {
    return exportChatsFrom(userFolder, limits);
  } catch (error) {
    return preserveResult(exportFailure(error));
  }
}

export async function importChats(userFolder: string, files: Record<string, string>): Promise<ChatImportResult> {
  const records = parseChatFiles(files);
  if (records.length === 0) return { applied: 0, kept: 0, notes: [], reload: false };
  const dbPath = globalDbPath(userFolder);
  if (!existsSync(dbPath)) {
    return { applied: 0, kept: 0, notes: ['Cursor chat database was not found, so chats were not imported.'], reload: false };
  }

  const grouped = groupRecords(records);
  const workspaces = listWorkspaces(userFolder);
  let applied = 0;
  let kept = 0;
  let db: SqliteDatabase | null = null;
  try {
    db = openDatabase(dbPath, false);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = applyGlobal(db, grouped.groups, workspaces);
      applied = result.applied;
      kept = result.kept;
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The write never started, so there is nothing to roll back.
      }
      throw error;
    }
  } catch (error) {
    return { applied: 0, kept: 0, notes: [importFailure(error)], reload: false };
  } finally {
    db?.close();
  }

  const legacyResult = applyLegacy(userFolder, grouped.legacy, workspaces);
  applied += legacyResult.applied;
  const notes: string[] = [];
  if (applied > 0) notes.push(`Merged ${applied} chat(s). Reload the window to see them.`);
  notes.push(...legacyResult.notes);
  return { applied, kept, notes, reload: applied > 0 };
}

export function readChatWatermark(userFolder: string): number | null {
  const dbPath = globalDbPath(userFolder);
  if (!existsSync(dbPath)) return null;
  let db: SqliteDatabase | null = null;
  try {
    db = openDatabase(dbPath, true);
    if (!tableExists(db, 'composerHeaders')) return null;
    const row = db.prepare('SELECT max(lastUpdatedAt) AS newest FROM composerHeaders').get() as { newest?: unknown } | undefined;
    return asNumber(row?.newest);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function exportChatsFrom(userFolder: string, limits: ChatLimits): ChatExportResult {
  const dbPath = globalDbPath(userFolder);
  if (!existsSync(dbPath)) return preserveResult('No Cursor chat database was found.');
  const chatCount = limits.chatCount ?? CHAT_COUNT;
  const messageCount = limits.messageCount ?? MESSAGE_COUNT;
  const db = openDatabase(dbPath, true);
  try {
    db.exec('PRAGMA query_only = ON');
    if (!tableExists(db, 'composerHeaders') || !tableExists(db, 'cursorDiskKV')) {
      return emptyExport();
    }
    const seen = new Set<string>();
    const bundles: Bundle[] = [];
    let skippedLarge = 0;
    let olderThanLimit = 0;
    for (const header of readHeaders(db)) {
      if (header.isSubagent === 1 || seen.has(header.composerId)) continue;
      if (bundles.length >= chatCount) {
        olderThanLimit += 1;
        continue;
      }
      const loaded = loadBundle(db, header, seen, limits.valueBytes, messageCount);
      skippedLarge += loaded.skippedLarge;
      if (loaded.records.length === 0) continue;
      bundles.push({ records: loaded.records, bytes: Buffer.byteLength(JSON.stringify(loaded.records)) });
    }
    const packed = selectByBudget(bundles, limits.budgetBytes);
    const records = packed.selected.flatMap((bundle) => bundle.records);
    const used = packed.selected.reduce((sum, bundle) => sum + bundle.bytes, 0);
    const legacy = loadLegacy(userFolder, Math.max(0, limits.budgetBytes - used), limits.valueBytes);
    skippedLarge += legacy.skippedLarge;
    records.push(...legacy.records);
    const omittedBySize = packed.omitted + legacy.omitted;
    const omitted = olderThanLimit + omittedBySize;
    const chunked = chunkChatRecords(records, limits.fileBytes, limits.valueBytes);
    skippedLarge += chunked.skippedLarge;
    const notes = exportNotes(chatCount, messageCount, packed.selected.length, olderThanLimit, omittedBySize, skippedLarge);
    if (chunked.files.length === 0) return { ...emptyExport(), notes, skippedLarge, omitted };
    return {
      files: chunked.files,
      preserve: false,
      notes,
      synced: packed.selected.length,
      omitted,
      skippedLarge,
    };
  } finally {
    db.close();
  }
}

function loadBundle(
  db: SqliteDatabase,
  header: ChatHeader,
  seen: Set<string>,
  valueBytes: number,
  messageCount: number
): { records: ChatRecord[]; skippedLarge: number } {
  if (seen.has(header.composerId)) return { records: [], skippedLarge: 0 };
  seen.add(header.composerId);
  if (Buffer.byteLength(header.value) > valueBytes) return { records: [], skippedLarge: 1 };
  const kv = loadKv(db, header.composerId, valueBytes, messageCount);
  const records: ChatRecord[] = [{ kind: 'header', header, complete: kv.skippedLarge === 0 }, ...kv.records];
  let skippedLarge = kv.skippedLarge;
  for (const childId of subComposerIds(kv.composerJson)) {
    if (seen.has(childId)) continue;
    const child = readHeader(db, childId);
    if (!child) continue;
    const nested = loadBundle(db, child, seen, valueBytes, messageCount);
    records.push(...nested.records);
    skippedLarge += nested.skippedLarge;
  }
  return { records, skippedLarge };
}

function loadKv(
  db: SqliteDatabase,
  composerId: string,
  valueBytes: number,
  messageCount: number
): { records: ChatRecord[]; skippedLarge: number; composerJson: string | null } {
  const records: ChatRecord[] = [];
  let skippedLarge = 0;
  let bubbleIds: string[] | null = null;
  const composerKey = `composerData:${composerId}`;
  const composerRow = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(composerKey) as { value?: unknown } | undefined;
  const composerJson = composerRow ? asText(composerRow.value) : null;
  if (composerJson !== null) {
    const trimmed = trimComposerMessages(composerJson, messageCount);
    bubbleIds = trimmed.bubbleIds;
    if (Buffer.byteLength(trimmed.json) > valueBytes) skippedLarge += 1;
    else records.push({ kind: 'kv', composerId, key: composerKey, value: trimmed.json });
  }
  const bounds = prefixBounds(`bubbleId:${composerId}:`);
  const bubbles = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ? ORDER BY key').all(bounds.start, bounds.end);
  const available: Array<{ key: string; value: string }> = [];
  for (const bubble of bubbles) {
    const row = bubble as { key?: unknown; value?: unknown };
    if (typeof row.key !== 'string' || !isAllowedKv(composerId, row.key)) continue;
    const value = asText(row.value);
    if (value === null) continue;
    available.push({ key: row.key, value });
  }
  for (const bubble of selectBubbles(available, bubbleIds, messageCount)) {
    if (Buffer.byteLength(bubble.value) > valueBytes) {
      skippedLarge += 1;
      continue;
    }
    records.push({ kind: 'kv', composerId, key: bubble.key, value: bubble.value });
  }
  return { records, skippedLarge, composerJson };
}

function selectBubbles(
  bubbles: Array<{ key: string; value: string }>,
  bubbleIds: string[] | null,
  messageLimit: number
): Array<{ key: string; value: string }> {
  if (messageLimit <= 0) return [];
  if (bubbleIds) {
    const byId = new Map<string, { key: string; value: string }>();
    for (const bubble of bubbles) {
      const id = bubbleIdFromKey(bubble.key);
      if (id) byId.set(id, bubble);
    }
    return bubbleIds.flatMap((id) => {
      const bubble = byId.get(id);
      return bubble ? [bubble] : [];
    });
  }
  const ordered = [...bubbles].sort((left, right) => bubbleTime(left.value) - bubbleTime(right.value) || left.key.localeCompare(right.key));
  return ordered.slice(-messageLimit);
}

function loadLegacy(userFolder: string, budget: number, valueBytes: number): { records: ChatRecord[]; skippedLarge: number; omitted: number } {
  const items: Array<{ bytes: number; record: ChatRecord }> = [];
  let skippedLarge = 0;
  for (const workspace of listWorkspaces(userFolder)) {
    const dbPath = join(userFolder, 'workspaceStorage', workspace.id, 'state.vscdb');
    if (!existsSync(dbPath)) continue;
    let db: SqliteDatabase | null = null;
    try {
      db = openDatabase(dbPath, true);
      db.exec('PRAGMA query_only = ON');
      if (!tableExists(db, 'ItemTable')) continue;
      for (const key of [LEGACY_COMPOSER, LEGACY_CHAT] as const) {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value?: unknown } | undefined;
        const value = row ? asText(row.value) : null;
        if (!value) continue;
        if (Buffer.byteLength(value) > valueBytes) {
          skippedLarge += 1;
          continue;
        }
        const record: ChatRecord = { kind: 'legacy', folder: workspace.folder, legacyKey: key, value };
        items.push({ bytes: Buffer.byteLength(JSON.stringify(record)), record });
      }
    } catch {
      continue;
    } finally {
      db?.close();
    }
  }
  const packed = selectByBudget(items, budget);
  return { records: packed.selected.map((item) => item.record), skippedLarge, omitted: packed.omitted };
}

function applyGlobal(
  db: SqliteDatabase,
  groups: Map<string, { header?: ChatHeader; complete: boolean; kv: Array<{ key: string; value: string }> }>,
  workspaces: WorkspaceFolder[]
): { applied: number; kept: number } {
  if (!tableExists(db, 'composerHeaders')) return { applied: 0, kept: 0 };
  const columns = tableColumns(db, 'composerHeaders');
  if (!columns.has('composerId')) return { applied: 0, kept: 0 };
  const hasKv = tableExists(db, 'cursorDiskKV');
  const current = db.prepare('SELECT lastUpdatedAt FROM composerHeaders WHERE composerId = ?');
  let applied = 0;
  let kept = 0;
  for (const [composerId, group] of groups) {
    if (!group.header) continue;
    const row = current.get(composerId) as { lastUpdatedAt?: unknown } | undefined;
    if (row && !remoteHeaderWins(asNumber(row.lastUpdatedAt), group.header.lastUpdatedAt)) {
      kept += 1;
      continue;
    }
    const remapped = remapHeaderValue(group.header.value, group.header.workspaceId, workspaces);
    upsertHeader(db, columns, { ...group.header, workspaceId: remapped.workspaceId, value: remapped.value });
    if (hasKv && group.kv.length > 0) {
      if (group.complete) replaceKv(db, composerId, group.kv);
      else upsertKv(db, group.kv);
    }
    applied += 1;
  }
  return { applied, kept };
}

function applyLegacy(
  userFolder: string,
  legacy: Map<string, { composerData?: string; chatData?: string }>,
  workspaces: WorkspaceFolder[]
): { applied: number; notes: string[] } {
  let applied = 0;
  const notes: string[] = [];
  for (const [folder, payload] of legacy) {
    const match = matchWorkspace([folder], workspaces);
    if (!match || !STORAGE_ID.test(match.id)) {
      notes.push(`No local workspace matched ${folder}.`);
      continue;
    }
    const dbPath = join(userFolder, 'workspaceStorage', match.id, 'state.vscdb');
    if (!existsSync(dbPath)) continue;
    let db: SqliteDatabase | null = null;
    try {
      db = openDatabase(dbPath, false);
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (tableExists(db, 'ItemTable')) {
          if (payload.composerData) {
            writeLegacy(db, LEGACY_COMPOSER, payload.composerData, mergeComposerData);
            applied += 1;
          }
          if (payload.chatData) {
            writeLegacy(db, LEGACY_CHAT, payload.chatData, mergeChatTabs);
            applied += 1;
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // The workspace database was left unchanged.
        }
        throw error;
      }
    } catch (error) {
      notes.push(importFailure(error));
    } finally {
      db?.close();
    }
  }
  return { applied, notes };
}

function writeLegacy(
  db: SqliteDatabase,
  key: LegacyKey,
  remoteJson: string,
  merge: (localJson: string | null, remoteJson: string) => string
): void {
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value?: unknown } | undefined;
  const local = row ? asText(row.value) : null;
  const merged = merge(local, remoteJson);
  db.prepare(`INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, merged);
}

function upsertHeader(db: SqliteDatabase, columns: Set<string>, header: ChatHeader): void {
  const fields = HEADER_FIELDS.filter((field) => columns.has(field));
  const updates = fields.filter((field) => field !== 'composerId');
  const sql = updates.length === 0
    ? `INSERT OR REPLACE INTO composerHeaders (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`
    : `INSERT INTO composerHeaders (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')}) ON CONFLICT(composerId) DO UPDATE SET ${updates.map((field) => `${field} = excluded.${field}`).join(', ')}`;
  db.prepare(sql).run(...fields.map((field) => headerValue(header, field)));
}

function upsertKv(db: SqliteDatabase, kv: Array<{ key: string; value: string }>): void {
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const item of kv) insert.run(item.key, item.value);
}

function replaceKv(db: SqliteDatabase, composerId: string, kv: Array<{ key: string; value: string }>): void {
  const bounds = prefixBounds(`bubbleId:${composerId}:`);
  db.prepare('DELETE FROM cursorDiskKV WHERE key = ?').run(`composerData:${composerId}`);
  db.prepare('DELETE FROM cursorDiskKV WHERE key >= ? AND key < ?').run(bounds.start, bounds.end);
  upsertKv(db, kv.filter((item) => isAllowedKv(composerId, item.key)));
}

function readHeaders(db: SqliteDatabase): ChatHeader[] {
  const columns = tableColumns(db, 'composerHeaders');
  const fields = HEADER_FIELDS.filter((field) => columns.has(field));
  if (!fields.includes('composerId')) return [];
  const rows = db.prepare(`SELECT ${fields.join(', ')} FROM composerHeaders ORDER BY lastUpdatedAt DESC, composerId ASC`).all();
  return rows.flatMap((row) => {
    const header = headerFromRow(row);
    return header ? [header] : [];
  });
}

function readHeader(db: SqliteDatabase, composerId: string): ChatHeader | null {
  const columns = tableColumns(db, 'composerHeaders');
  const fields = HEADER_FIELDS.filter((field) => columns.has(field));
  if (!fields.includes('composerId')) return null;
  const row = db.prepare(`SELECT ${fields.join(', ')} FROM composerHeaders WHERE composerId = ?`).get(composerId);
  return row ? headerFromRow(row) : null;
}

function headerFromRow(row: unknown): ChatHeader | null {
  const record = row as Record<string, unknown>;
  if (typeof record.composerId !== 'string' || !isComposerId(record.composerId)) return null;
  return {
    composerId: record.composerId,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : null,
    createdAt: asNumber(record.createdAt),
    lastUpdatedAt: asNumber(record.lastUpdatedAt),
    isArchived: asNumber(record.isArchived),
    isSubagent: asNumber(record.isSubagent),
    recency: asNumber(record.recency),
    checkpointAt: asNumber(record.checkpointAt),
    value: asText(record.value) ?? '',
    subagentTypeName: typeof record.subagentTypeName === 'string' ? record.subagentTypeName : null,
  };
}

function groupRecords(records: ChatRecord[]): {
  groups: Map<string, { header?: ChatHeader; complete: boolean; kv: Array<{ key: string; value: string }> }>;
  legacy: Map<string, { composerData?: string; chatData?: string }>;
} {
  const groups = new Map<string, { header?: ChatHeader; complete: boolean; kv: Array<{ key: string; value: string }> }>();
  const legacy = new Map<string, { composerData?: string; chatData?: string }>();
  for (const record of records) {
    if (record.kind === 'header') {
      const group = groups.get(record.header.composerId) ?? { complete: true, kv: [] };
      group.header = record.header;
      group.complete = record.complete;
      groups.set(record.header.composerId, group);
      continue;
    }
    if (record.kind === 'kv') {
      const group = groups.get(record.composerId) ?? { complete: true, kv: [] };
      group.kv.push({ key: record.key, value: record.value });
      groups.set(record.composerId, group);
      continue;
    }
    const entry = legacy.get(record.folder) ?? {};
    if (record.legacyKey === LEGACY_COMPOSER) entry.composerData = record.value;
    else entry.chatData = record.value;
    legacy.set(record.folder, entry);
  }
  return { groups, legacy };
}

function parseChatFiles(files: Record<string, string>): ChatRecord[] {
  const records: ChatRecord[] = [];
  for (const name of Object.keys(files).filter(isChatChunkName).sort()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(files[name]);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== 1) continue;
    const list = (parsed as { records?: unknown }).records;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const record = readRecord(item);
      if (record) records.push(record);
    }
  }
  return records;
}

function readRecord(value: unknown): ChatRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'header') {
    const header = headerFromRow(record.header);
    return header ? { kind: 'header', header, complete: record.complete !== false } : null;
  }
  if (record.kind === 'kv') {
    if (typeof record.composerId !== 'string' || !isComposerId(record.composerId)) return null;
    if (typeof record.key !== 'string' || typeof record.value !== 'string') return null;
    if (!isAllowedKv(record.composerId, record.key)) return null;
    return { kind: 'kv', composerId: record.composerId, key: record.key, value: record.value };
  }
  if (record.kind === 'legacy') {
    if (record.legacyKey !== LEGACY_COMPOSER && record.legacyKey !== LEGACY_CHAT) return null;
    if (typeof record.folder !== 'string' || record.folder.trim() === '') return null;
    if (typeof record.value !== 'string') return null;
    return { kind: 'legacy', folder: record.folder, legacyKey: record.legacyKey, value: record.value };
  }
  return null;
}

function listWorkspaces(userFolder: string): WorkspaceFolder[] {
  const root = join(userFolder, 'workspaceStorage');
  let names: string[] = [];
  try {
    names = readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() && STORAGE_ID.test(entry.name) ? [entry.name] : []));
  } catch {
    return [];
  }
  const workspaces: WorkspaceFolder[] = [];
  for (const id of names) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, id, 'workspace.json'), 'utf8')) as { folder?: unknown };
      if (typeof parsed.folder !== 'string' || parsed.folder.trim() === '') continue;
      workspaces.push({ id, folder: parsed.folder });
    } catch {
      continue;
    }
  }
  return workspaces;
}

function mergeCollection(
  localJson: string | null,
  remoteJson: string,
  field: 'allComposers' | 'tabs',
  idOf: (item: Record<string, unknown>) => string | null,
  timeOf: (item: Record<string, unknown>) => number | null
): string {
  const remote = parseObject(remoteJson);
  if (!remote) return localJson ?? remoteJson;
  const local = localJson ? parseObject(localJson) : null;
  if (!local) return remoteJson;
  local[field] = mergeById(objectArray(local[field]), objectArray(remote[field]), idOf, timeOf);
  return JSON.stringify(local);
}

function mergeById(
  local: Record<string, unknown>[],
  remote: Record<string, unknown>[],
  idOf: (item: Record<string, unknown>) => string | null,
  timeOf: (item: Record<string, unknown>) => number | null
): Record<string, unknown>[] {
  const result = [...local];
  const index = new Map<string, number>();
  result.forEach((item, position) => {
    const id = idOf(item);
    if (id) index.set(id, position);
  });
  for (const item of remote) {
    const id = idOf(item);
    if (!id) continue;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, result.length);
      result.push(item);
      continue;
    }
    if (remoteHeaderWins(timeOf(result[at]), timeOf(item))) result[at] = item;
  }
  return result;
}

function openDatabase(path: string, readOnly: boolean): SqliteDatabase {
  let imported: { DatabaseSync?: new (location: string, options?: { readOnly?: boolean; timeout?: number }) => SqliteDatabase };
  try {
    imported = nodeRequire('node:sqlite') as typeof imported;
  } catch {
    throw new SqliteMissing();
  }
  if (!imported.DatabaseSync) throw new SqliteMissing();
  return new imported.DatabaseSync(path, { readOnly, timeout: 5000 });
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as { name?: unknown } | undefined;
  return row?.name === name;
}

function tableColumns(db: SqliteDatabase, name: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${name})`).all();
  const columns = new Set<string>();
  for (const row of rows) {
    const column = (row as { name?: unknown }).name;
    if (typeof column === 'string') columns.add(column);
  }
  return columns;
}

function fileContent(records: ChatRecord[]): string {
  return JSON.stringify({ v: 1, records });
}

function recordValueBytes(record: ChatRecord): number {
  if (record.kind === 'header') return Buffer.byteLength(record.header.value);
  return Buffer.byteLength(record.value);
}

function prefixBounds(prefix: string): { start: string; end: string } {
  const code = prefix.charCodeAt(prefix.length - 1);
  return { start: prefix, end: prefix.slice(0, -1) + String.fromCharCode(code + 1) };
}

function isBubbleHeader(value: unknown): value is { bubbleId: string } {
  return Boolean(value) && typeof value === 'object' && typeof (value as { bubbleId?: unknown }).bubbleId === 'string' && (value as { bubbleId: string }).bubbleId.length > 0;
}

function bubbleIdFromKey(key: string): string | null {
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'bubbleId') return null;
  return parts.slice(2).join(':');
}

function bubbleTime(value: string): number {
  try {
    const parsed = JSON.parse(value) as { createdAt?: unknown };
    if (typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)) return parsed.createdAt;
    if (typeof parsed.createdAt === 'string') {
      const parsedTime = Date.parse(parsed.createdAt);
      if (!Number.isNaN(parsedTime)) return parsedTime;
    }
  } catch {
    return 0;
  }
  return 0;
}

function subComposerIds(composerJson: string | null): string[] {
  if (!composerJson) return [];
  try {
    const parsed = JSON.parse(composerJson) as { subComposerIds?: unknown };
    if (!Array.isArray(parsed.subComposerIds)) return [];
    return parsed.subComposerIds.filter((id): id is string => typeof id === 'string' && isComposerId(id));
  } catch {
    return [];
  }
}

function folderCandidates(identifier: unknown): string[] {
  if (!identifier || typeof identifier !== 'object') return [];
  const uri = (identifier as { uri?: unknown }).uri;
  if (typeof uri === 'string') return [uri];
  if (!uri || typeof uri !== 'object') return [];
  const record = uri as Record<string, unknown>;
  return [record.external, record.fsPath, record.path].filter((item): item is string => typeof item === 'string');
}

function folderBasename(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function composerIdentity(item: Record<string, unknown>): string | null {
  return typeof item.composerId === 'string' ? item.composerId : null;
}

function composerTime(item: Record<string, unknown>): number | null {
  return asNumber(item.lastUpdatedAt) ?? asNumber(item.createdAt);
}

function tabIdentity(item: Record<string, unknown>): string | null {
  if (typeof item.tabId === 'string' && item.tabId) return item.tabId;
  if (typeof item.id === 'string' && item.id) return item.id;
  return null;
}

function tabTime(item: Record<string, unknown>): number | null {
  const value = item.lastSendTime ?? item.timestamp;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    return asNumber(value);
  }
  return null;
}

function headerValue(header: ChatHeader, field: HeaderField): string | number | null {
  return header[field];
}

function isComposerId(value: string): boolean {
  return COMPOSER_ID.test(value);
}

function isAllowedKv(composerId: string, key: string): boolean {
  return key === `composerData:${composerId}` || key.startsWith(`bubbleId:${composerId}:`);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return null;
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function objectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function globalDbPath(userFolder: string): string {
  return join(userFolder, 'globalStorage', 'state.vscdb');
}

function emptyExport(): ChatExportResult {
  return { files: [], preserve: true, notes: [], synced: 0, omitted: 0, skippedLarge: 0 };
}

function preserveResult(note: string): ChatExportResult {
  return { files: [], preserve: true, notes: note ? [note] : [], synced: 0, omitted: 0, skippedLarge: 0 };
}

function exportNotes(
  chatCount: number,
  messageCount: number,
  synced: number,
  olderThanLimit: number,
  omittedBySize: number,
  skippedLarge: number
): string[] {
  const notes: string[] = [];
  if (synced > 0) notes.push(`Included ${synced} chat(s), each with its last ${messageCount} message(s).`);
  if (olderThanLimit > 0) notes.push(`Kept the ${chatCount} newest chats. ${olderThanLimit} older chat(s) stayed on this machine.`);
  if (omittedBySize > 0) notes.push(`${omittedBySize} chat(s) did not fit in the upload and stayed on this machine.`);
  if (skippedLarge > 0) notes.push(`Skipped ${skippedLarge} chat value(s) larger than 1 MB.`);
  return notes;
}

function exportFailure(error: unknown): string {
  if (error instanceof SqliteMissing) return error.message;
  if (isBusy(error)) return 'Cursor has the chat database open. Chat history was not uploaded.';
  return error instanceof Error ? error.message : 'Chat history could not be read.';
}

function importFailure(error: unknown): string {
  if (error instanceof SqliteMissing) return error.message;
  if (isBusy(error)) return 'Cursor has the chat database open. Chat history was not changed.';
  return error instanceof Error ? error.message : 'Chat history could not be written.';
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const coded = error as { code?: unknown; errcode?: unknown };
  if (coded.code === 'ERR_SQLITE_BUSY' || coded.errcode === 5) return true;
  return error.message.includes('SQLITE_BUSY') || error.message.includes('database is locked');
}
