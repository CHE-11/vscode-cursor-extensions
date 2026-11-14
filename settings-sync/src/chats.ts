import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const nodeRequire = createRequire(__filename);

export const CHAT_PREFIX = 'chats|';
export const CHAT_BUDGET_BYTES = 24_000_000;
export const CHAT_FILE_BYTES = 900_000;
export const CHAT_VALUE_BYTES = 1_000_000;
export const CHAT_COUNT = 15;
export const MESSAGE_COUNT = 30;
const CHAT_HARD_FILE_BYTES = 990_000;
const BLOB_PART_BYTES = 500_000;
const MAX_BLOBS_PER_CHAT = 5_000;
const MAX_CHAT_BLOB_BYTES = CHAT_BUDGET_BYTES;
const BLOB_PREFIX = 'agentKv:blob:';
const CHECKPOINT_PREFIX = 'agentKv:checkpoint:';
const BUBBLE_CHECKPOINT_PREFIX = 'agentKv:bubbleCheckpoint:';
const BLOB_ID = /^[0-9a-f]{64}$/;

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

interface StoredKv {
  key: string;
  value: string;
  encoding?: 'base64';
  part?: number;
  parts?: number;
}

export type ChatRecord =
  | { kind: 'header'; header: ChatHeader; complete: boolean }
  | ({ kind: 'kv'; composerId: string } & StoredKv)
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
  allChats?: boolean;
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

export function trimComposerMessages(composerJson: string, messageLimit: number | null): { json: string; bubbleIds: string[] | null } {
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
    const headers = record.fullConversationHeadersOnly.filter(isBubbleHeader);
    if (messageLimit !== null && messageLimit <= 0) {
      record.fullConversationHeadersOnly = [];
      bubbleIds = [];
    } else if (headers.length > 0) {
      const kept = messageLimit === null ? headers : headers.slice(-messageLimit);
      record.fullConversationHeadersOnly = kept;
      bubbleIds = kept.map((item) => item.bubbleId);
    }
    if (bubbleIds && record.conversationMap && typeof record.conversationMap === 'object' && !Array.isArray(record.conversationMap)) {
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
  const allChats = limits.allChats === true;
  const chatCount = allChats ? null : limits.chatCount ?? CHAT_COUNT;
  const messageCount = allChats ? null : limits.messageCount ?? MESSAGE_COUNT;
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
    let unavailable = 0;
    let omittedEarly = 0;
    let usedBytes = 0;
    for (const header of readHeaders(db)) {
      if (header.isSubagent === 1 || seen.has(header.composerId)) continue;
      if (usedBytes >= limits.budgetBytes) break;
      if (chatCount !== null && bundles.length >= chatCount) {
        olderThanLimit += 1;
        continue;
      }
      const loaded = loadBundle(db, header, seen, limits.valueBytes, messageCount);
      skippedLarge += loaded.skippedLarge;
      unavailable += loaded.unavailable;
      if (loaded.records.length === 0) continue;
      const bytes = Buffer.byteLength(JSON.stringify(loaded.records));
      if (bytes > limits.budgetBytes || usedBytes + bytes > limits.budgetBytes) {
        omittedEarly += 1;
        continue;
      }
      usedBytes += bytes;
      bundles.push({ records: loaded.records, bytes });
    }
    const packed = selectByBudget(bundles, limits.budgetBytes);
    const records = packed.selected.flatMap((bundle) => bundle.records);
    const used = packed.selected.reduce((sum, bundle) => sum + bundle.bytes, 0);
    const legacy = loadLegacy(userFolder, Math.max(0, limits.budgetBytes - used), limits.valueBytes);
    skippedLarge += legacy.skippedLarge;
    records.push(...legacy.records);
    const omittedBySize = packed.omitted + legacy.omitted + omittedEarly;
    const omitted = olderThanLimit + omittedBySize;
    const chunked = chunkChatRecords(records, limits.fileBytes, limits.valueBytes);
    skippedLarge += chunked.skippedLarge;
    const notes = exportNotes(chatCount, messageCount, packed.selected.length, olderThanLimit, omittedBySize, skippedLarge, unavailable);
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
  messageCount: number | null
): { records: ChatRecord[]; skippedLarge: number; unavailable: number } {
  if (seen.has(header.composerId)) return { records: [], skippedLarge: 0, unavailable: 0 };
  seen.add(header.composerId);
  if (Buffer.byteLength(header.value) > valueBytes) return { records: [], skippedLarge: 1, unavailable: 0 };
  const kv = loadKv(db, header.composerId, valueBytes, messageCount);
  if (kv.unavailable) return { records: [], skippedLarge: kv.skippedLarge, unavailable: 1 };
  if (kv.oversized) return { records: [], skippedLarge: Math.max(kv.skippedLarge, 1), unavailable: 0 };
  if (kv.records.length === 0) return { records: [], skippedLarge: kv.skippedLarge, unavailable: 1 };
  const records: ChatRecord[] = [{ kind: 'header', header, complete: kv.skippedLarge === 0 }, ...kv.records];
  let skippedLarge = kv.skippedLarge;
  let unavailable = 0;
  for (const childId of subComposerIds(kv.composerJson)) {
    if (seen.has(childId)) continue;
    const child = readHeader(db, childId);
    if (!child) continue;
    const nested = loadBundle(db, child, seen, valueBytes, messageCount);
    skippedLarge += nested.skippedLarge;
    unavailable += nested.unavailable;
    records.push(...nested.records);
  }
  return { records, skippedLarge, unavailable };
}

function loadKv(
  db: SqliteDatabase,
  composerId: string,
  valueBytes: number,
  messageCount: number | null
): { records: ChatRecord[]; skippedLarge: number; composerJson: string | null; unavailable: boolean; oversized: boolean } {
  const records: ChatRecord[] = [];
  let skippedLarge = 0;
  let bubbleIds: string[] | null = null;
  const composerKey = `composerData:${composerId}`;
  const composerRow = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(composerKey) as { value?: unknown } | undefined;
  const composerJson = composerRow ? asText(composerRow.value) : null;
  if (composerJson !== null) {
    const trimmed = trimComposerMessages(composerJson, messageCount);
    bubbleIds = trimmed.bubbleIds;
    if (Buffer.byteLength(trimmed.json) > valueBytes) return { records: [], skippedLarge: 1, composerJson, unavailable: false, oversized: true };
    records.push({ kind: 'kv', composerId, key: composerKey, value: trimmed.json });
    const blobs = loadConversationBlobs(db, composerId, trimmed.json);
    if (blobs.unavailable || blobs.oversized) {
      return { records: [], skippedLarge, composerJson, unavailable: blobs.unavailable, oversized: blobs.oversized };
    }
    records.push(...blobs.records);
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
  return { records, skippedLarge, composerJson, unavailable: false, oversized: false };
}

// The history pane reads composerHeaders. Opening a chat follows blob ids in
// conversationState, stored as agentKv:blob:<sha256>. Without those blobs Cursor
// reports that the conversation data is missing.
function loadConversationBlobs(
  db: SqliteDatabase,
  composerId: string,
  composerJson: string
): { records: ChatRecord[]; unavailable: boolean; oversized: boolean } {
  const decoded = decodeConversationState(conversationStateOf(composerJson));
  if (decoded && !readProtobuf(decoded)) return { records: [], unavailable: true, oversized: false };
  const required = new Set(decoded ? requiredTurnIds(decoded) : []);
  const queue = [...(decoded ? protobufBlobIds(decoded) : []), ...checkpointBlobIds(db, composerId)];
  if (required.size === 0 && queue.length === 0) return { records: [], unavailable: false, oversized: false };

  const readBlob = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
  const seen = new Set<string>();
  const loaded = new Set<string>();
  const records: ChatRecord[] = [];
  let bytes = 0;
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || !BLOB_ID.test(id) || seen.has(id)) continue;
    if (seen.size >= MAX_BLOBS_PER_CHAT) return { records: [], unavailable: false, oversized: true };
    seen.add(id);
    const row = readBlob.get(`${BLOB_PREFIX}${id}`) as { value?: unknown } | undefined;
    const blob = row ? asBytes(row.value) : null;
    if (!blob || createHash('sha256').update(blob).digest('hex') !== id) {
      if (required.has(id)) return { records: [], unavailable: true, oversized: false };
      continue;
    }
    bytes += blob.length;
    if (bytes > MAX_CHAT_BLOB_BYTES) return { records: [], unavailable: false, oversized: true };
    loaded.add(id);
    records.push(...blobPieces(composerId, id, blob));
    if (!isTextBlob(blob)) {
      for (const nested of protobufBlobIds(blob)) queue.push(nested);
    }
  }
  records.push(...checkpointPieces(db, composerId, loaded));
  return { records, unavailable: false, oversized: false };
}

function blobPieces(composerId: string, id: string, bytes: Buffer): ChatRecord[] {
  const key = `${BLOB_PREFIX}${id}`;
  const utf8 = asUtf8(bytes);
  if (utf8 !== null && Buffer.byteLength(utf8) <= BLOB_PART_BYTES) {
    return [{ kind: 'kv', composerId, key, value: utf8 }];
  }
  const payload = bytes.toString('base64');
  if (payload.length <= BLOB_PART_BYTES) {
    return [{ kind: 'kv', composerId, key, value: payload, encoding: 'base64' }];
  }
  const partCount = Math.ceil(payload.length / BLOB_PART_BYTES);
  const pieces: ChatRecord[] = [];
  for (let part = 0; part < partCount; part += 1) {
    pieces.push({
      kind: 'kv',
      composerId,
      key,
      value: payload.slice(part * BLOB_PART_BYTES, (part + 1) * BLOB_PART_BYTES),
      encoding: 'base64',
      part,
      parts: partCount,
    });
  }
  return pieces;
}

function checkpointBlobIds(db: SqliteDatabase, composerId: string): string[] {
  const ids: string[] = [];
  const direct = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(`${CHECKPOINT_PREFIX}${composerId}`) as { value?: unknown } | undefined;
  const directId = direct ? asText(direct.value)?.trim() : undefined;
  if (directId && BLOB_ID.test(directId)) ids.push(directId);
  const bounds = prefixBounds(`${BUBBLE_CHECKPOINT_PREFIX}${composerId}:`);
  const rows = db.prepare('SELECT value FROM cursorDiskKV WHERE key >= ? AND key < ?').all(bounds.start, bounds.end);
  for (const row of rows) {
    const id = asText((row as { value?: unknown }).value)?.trim();
    if (id && BLOB_ID.test(id)) ids.push(id);
  }
  return ids;
}

function checkpointPieces(db: SqliteDatabase, composerId: string, loaded: Set<string>): ChatRecord[] {
  const records: ChatRecord[] = [];
  const directKey = `${CHECKPOINT_PREFIX}${composerId}`;
  const direct = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(directKey) as { value?: unknown } | undefined;
  const directId = direct ? asText(direct.value)?.trim() : undefined;
  if (directId && loaded.has(directId)) records.push({ kind: 'kv', composerId, key: directKey, value: directId });
  const bounds = prefixBounds(`${BUBBLE_CHECKPOINT_PREFIX}${composerId}:`);
  const rows = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key >= ? AND key < ?').all(bounds.start, bounds.end);
  for (const row of rows) {
    const record = row as { key?: unknown; value?: unknown };
    if (typeof record.key !== 'string' || !isCheckpointKey(composerId, record.key)) continue;
    const id = asText(record.value)?.trim();
    if (id && loaded.has(id)) records.push({ kind: 'kv', composerId, key: record.key, value: id });
  }
  return records;
}

function selectBubbles(
  bubbles: Array<{ key: string; value: string }>,
  bubbleIds: string[] | null,
  messageLimit: number | null
): Array<{ key: string; value: string }> {
  if (messageLimit !== null && messageLimit <= 0) return [];
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
  return messageLimit === null ? ordered : ordered.slice(-messageLimit);
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
  groups: Map<string, { header?: ChatHeader; complete: boolean; kv: StoredKv[] }>,
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
    const assembled = assembleKv(group.kv).filter((item) => isAllowedKv(composerId, item.key));
    const row = current.get(composerId) as { lastUpdatedAt?: unknown } | undefined;
    if (row && !remoteHeaderWins(asNumber(row.lastUpdatedAt), group.header.lastUpdatedAt)) {
      kept += 1;
      if (hasKv) upsertKv(db, assembled.filter((item) => isBlobKey(item.key)));
      continue;
    }
    const remapped = remapHeaderValue(group.header.value, group.header.workspaceId, workspaces);
    upsertHeader(db, columns, { ...group.header, workspaceId: remapped.workspaceId, value: remapped.value });
    if (hasKv && assembled.length > 0) {
      if (group.complete) replaceKv(db, composerId, assembled);
      else upsertKv(db, assembled);
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

function upsertKv(db: SqliteDatabase, kv: Array<{ key: string; value: string | Buffer }>): void {
  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const item of kv) insert.run(item.key, item.value);
}

function replaceKv(db: SqliteDatabase, composerId: string, kv: Array<{ key: string; value: string | Buffer }>): void {
  const bounds = prefixBounds(`bubbleId:${composerId}:`);
  const checkpointBounds = prefixBounds(`${BUBBLE_CHECKPOINT_PREFIX}${composerId}:`);
  db.prepare('DELETE FROM cursorDiskKV WHERE key = ?').run(`composerData:${composerId}`);
  db.prepare('DELETE FROM cursorDiskKV WHERE key >= ? AND key < ?').run(bounds.start, bounds.end);
  db.prepare('DELETE FROM cursorDiskKV WHERE key = ?').run(`${CHECKPOINT_PREFIX}${composerId}`);
  db.prepare('DELETE FROM cursorDiskKV WHERE key >= ? AND key < ?').run(checkpointBounds.start, checkpointBounds.end);
  upsertKv(db, kv.filter((item) => isAllowedKv(composerId, item.key)));
}

function assembleKv(items: StoredKv[]): Array<{ key: string; value: string | Buffer }> {
  const groups = new Map<string, StoredKv[]>();
  for (const item of items) {
    const list = groups.get(item.key) ?? [];
    list.push(item);
    groups.set(item.key, list);
  }
  const assembled: Array<{ key: string; value: string | Buffer }> = [];
  for (const [key, pieces] of groups) {
    const value = decodePieces(key, pieces);
    if (value !== null) assembled.push({ key, value });
  }
  return assembled;
}

function decodePieces(key: string, pieces: StoredKv[]): string | Buffer | null {
  const encoding = pieces[0]?.encoding ?? 'utf8';
  if (!pieces[0] || pieces.some((piece) => (piece.encoding ?? 'utf8') !== encoding)) return null;
  const numbered = pieces.some((piece) => piece.part !== undefined || piece.parts !== undefined);
  let payload = '';
  if (!numbered) {
    const conflict = pieces.length > 1 && pieces.some((piece) => piece.value !== pieces[0].value);
    if (conflict && isBlobKey(key)) return null;
    payload = conflict ? pieces[pieces.length - 1].value : pieces[0].value;
  } else {
    const expected = pieces[0].parts ?? 0;
    if (expected < 1 || expected > 100 || pieces.length !== expected) return null;
    if (pieces.some((piece) => piece.parts !== expected || piece.part === undefined)) return null;
    const ordered = [...pieces].sort((left, right) => (left.part ?? 0) - (right.part ?? 0));
    for (let index = 0; index < ordered.length; index += 1) {
      if (ordered[index].part !== index) return null;
    }
    payload = ordered.map((piece) => piece.value).join('');
  }
  const bytes = encoding === 'base64' ? Buffer.from(payload, 'base64') : Buffer.from(payload, 'utf8');
  if (isBlobKey(key)) {
    if (createHash('sha256').update(bytes).digest('hex') !== key.slice(BLOB_PREFIX.length)) return null;
    return bytes;
  }
  return encoding === 'base64' ? bytes : payload;
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
  groups: Map<string, { header?: ChatHeader; complete: boolean; kv: StoredKv[] }>;
  legacy: Map<string, { composerData?: string; chatData?: string }>;
} {
  const groups = new Map<string, { header?: ChatHeader; complete: boolean; kv: StoredKv[] }>();
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
      group.kv.push({
        key: record.key,
        value: record.value,
        encoding: record.encoding,
        part: record.part,
        parts: record.parts,
      });
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
    const piece: Extract<ChatRecord, { kind: 'kv' }> = { kind: 'kv', composerId: record.composerId, key: record.key, value: record.value };
    if (record.encoding === 'base64') piece.encoding = 'base64';
    else if (record.encoding !== undefined) return null;
    if (record.part !== undefined || record.parts !== undefined) {
      if (typeof record.part !== 'number' || typeof record.parts !== 'number') return null;
      if (!Number.isInteger(record.part) || !Number.isInteger(record.parts)) return null;
      if (record.part < 0 || record.parts < 1 || record.parts > 100 || record.part >= record.parts) return null;
      piece.part = record.part;
      piece.parts = record.parts;
    }
    return piece;
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
    const parsed = JSON.parse(composerJson) as { subComposerIds?: unknown; subagentComposerIds?: unknown };
    const lists = [parsed.subComposerIds, parsed.subagentComposerIds];
    const ids: string[] = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const id of list) {
        if (typeof id === 'string' && isComposerId(id)) ids.push(id);
      }
    }
    return ids;
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
  return key === `composerData:${composerId}` || key.startsWith(`bubbleId:${composerId}:`) || isBlobKey(key) || isCheckpointKey(composerId, key);
}

function isBlobKey(key: string): boolean {
  return key.startsWith(BLOB_PREFIX) && BLOB_ID.test(key.slice(BLOB_PREFIX.length));
}

function isCheckpointKey(composerId: string, key: string): boolean {
  if (key === `${CHECKPOINT_PREFIX}${composerId}`) return true;
  const prefix = `${BUBBLE_CHECKPOINT_PREFIX}${composerId}:`;
  if (!key.startsWith(prefix) || key.length > prefix.length + 200) return false;
  return /^[A-Za-z0-9_.:-]+$/.test(key.slice(prefix.length));
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

function asBytes(value: unknown): Buffer | null {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function asUtf8(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

function conversationStateOf(composerJson: string): string | null {
  try {
    const parsed = JSON.parse(composerJson) as { conversationState?: unknown };
    return typeof parsed.conversationState === 'string' ? parsed.conversationState : null;
  } catch {
    return null;
  }
}

function decodeConversationState(value: string | null): Buffer | null {
  if (!value || value === '~') return null;
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (!body || body.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  const buf = Buffer.from(body, 'base64');
  return buf.length > 0 ? buf : null;
}

function requiredTurnIds(buf: Buffer): string[] {
  const fields = readProtobuf(buf);
  if (!fields) return [];
  return fields.flatMap((field) => (field.field === 1 && field.bytes?.length === 32 ? [field.bytes.toString('hex')] : []));
}

function protobufBlobIds(buf: Buffer, depth = 0): string[] {
  const fields = readProtobuf(buf);
  if (!fields) return [];
  const ids: string[] = [];
  for (const field of fields) {
    if (!field.bytes) continue;
    if (field.bytes.length === 32) ids.push(field.bytes.toString('hex'));
    else if (depth < 6 && field.bytes.length > 32) ids.push(...protobufBlobIds(field.bytes, depth + 1));
  }
  return ids;
}

function readProtobuf(buf: Buffer): Array<{ field: number; bytes?: Buffer }> | null {
  const fields: Array<{ field: number; bytes?: Buffer }> = [];
  let offset = 0;
  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    if (!tag) return null;
    offset = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;
    if (field === 0) return null;
    if (wire === 0) {
      const value = readVarint(buf, offset);
      if (!value) return null;
      offset = value.next;
      fields.push({ field });
    } else if (wire === 2) {
      const length = readVarint(buf, offset);
      if (!length || length.value < 0) return null;
      const start = length.next;
      if (start + length.value > buf.length) return null;
      fields.push({ field, bytes: Buffer.from(buf.subarray(start, start + length.value)) });
      offset = start + length.value;
    } else if (wire === 1) {
      if (offset + 8 > buf.length) return null;
      offset += 8;
      fields.push({ field });
    } else if (wire === 5) {
      if (offset + 4 > buf.length) return null;
      offset += 4;
      fields.push({ field });
    } else {
      return null;
    }
  }
  return fields;
}

function readVarint(buf: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0;
  let factor = 1;
  let cursor = offset;
  for (let byteIndex = 0; cursor < buf.length && byteIndex < 10; byteIndex += 1) {
    const byte = buf[cursor];
    cursor += 1;
    value += (byte & 0x7f) * factor;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    factor *= 128;
  }
  return null;
}

function isTextBlob(buf: Buffer): boolean {
  const text = asUtf8(buf);
  if (text === null) return false;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  const sample = Math.min(buf.length, 256);
  if (sample === 0) return true;
  let printable = 0;
  for (let index = 0; index < sample; index += 1) {
    const byte = buf[index];
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) printable += 1;
  }
  return printable / sample > 0.9;
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
  chatCount: number | null,
  messageCount: number | null,
  synced: number,
  olderThanLimit: number,
  omittedBySize: number,
  skippedLarge: number,
  unavailable: number
): string[] {
  const notes: string[] = [];
  if (synced > 0) {
    notes.push(messageCount === null
      ? `Included ${synced} chat(s) with the conversation data needed to open them.`
      : `Included ${synced} chat(s). Each keeps its last ${messageCount} bubble message(s) and the agent transcript needed to open it.`);
  }
  if (chatCount !== null && olderThanLimit > 0) notes.push(`Kept the ${chatCount} newest chats. ${olderThanLimit} older chat(s) stayed on this machine.`);
  if (omittedBySize > 0) notes.push(`${omittedBySize} chat(s) did not fit in the upload and stayed on this machine.`);
  if (skippedLarge > 0) notes.push(`Skipped ${skippedLarge} chat value(s) that were too large to upload.`);
  if (unavailable > 0) notes.push(`Left out ${unavailable} chat(s) whose conversation data is missing.`);
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
