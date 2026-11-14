import { isAbsolute, relative, resolve, sep } from 'node:path';

export const CUSTOM_PREFIX = '|customized_sync|';

export const FILES = {
  settings: 'settings.json',
  launch: 'launch.json',
  keybindings: 'keybindings.json',
  keybindingsMac: 'keybindingsMac.json',
  extensions: 'extensions.json',
  locale: 'locale.json',
  cloud: 'cloudSettings',
  local: 'syncLocalSettings.json',
  lock: 'sync.lock',
} as const;

const BLOCKED_FILE_NAMES = new Set<string>([FILES.local, FILES.lock, FILES.cloud]);

const DEFAULT_IGNORE_FILES = [
  'state.*',
  FILES.local,
  '.DS_Store',
  FILES.lock,
  'projects.json',
  'projects_cache_vscode.json',
  'projects_cache_git.json',
  'projects_cache_svn.json',
  'gpm_projects.json',
  'gpm-recentItems.json',
];

const DEFAULT_IGNORE_FOLDERS = ['workspaceStorage', 'globalStorage', 'History'];

export const CHAT_COUNT_RANGE = { min: 1, max: 100, fallback: 15 };
export const MESSAGE_COUNT_RANGE = { min: 1, max: 200, fallback: 30 };

export function clampCount(value: unknown, range: { min: number; max: number; fallback: number }): number {
  const parsed = typeof value === 'number' && Number.isInteger(value) ? value : range.fallback;
  return Math.min(Math.max(parsed, range.min), range.max);
}

export interface LocalSettings {
  ignoreUploadFiles: string[];
  ignoreUploadFolders: string[];
  ignoreExtensions: string[];
  supportedFileExtensions: string[];
  customFiles: Record<string, string>;
  lastUpload: string | null;
  lastDownload: string | null;
  chatCount: number;
  messageCount: number;
}

export function defaultLocalSettings(): LocalSettings {
  return {
    ignoreUploadFiles: [...DEFAULT_IGNORE_FILES],
    ignoreUploadFolders: [...DEFAULT_IGNORE_FOLDERS],
    ignoreExtensions: [],
    supportedFileExtensions: ['json', 'code-snippets'],
    customFiles: {},
    lastUpload: null,
    lastDownload: null,
    chatCount: CHAT_COUNT_RANGE.fallback,
    messageCount: MESSAGE_COUNT_RANGE.fallback,
  };
}

export function normalizeLocal(raw: unknown): { settings: LocalSettings; legacyToken: string; changed: boolean } {
  const defaults = defaultLocalSettings();
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const legacyToken = typeof record.token === 'string' ? record.token.trim() : '';
  const ignoreUploadFiles = mergeStrings(record.ignoreUploadFiles, defaults.ignoreUploadFiles);
  const ignoreUploadFolders = mergeStrings(record.ignoreUploadFolders, defaults.ignoreUploadFolders);
  const ignoreExtensions = stringArray(record.ignoreExtensions);
  const supported = stringArray(record.supportedFileExtensions);
  const chatCount = clampCount(record.chatCount, CHAT_COUNT_RANGE);
  const messageCount = clampCount(record.messageCount, MESSAGE_COUNT_RANGE);
  const settings: LocalSettings = {
    ignoreUploadFiles,
    ignoreUploadFolders,
    ignoreExtensions,
    supportedFileExtensions: supported.length > 0 ? supported : defaults.supportedFileExtensions,
    customFiles: stringMap(record.customFiles),
    lastUpload: dateString(record.lastUpload),
    lastDownload: dateString(record.lastDownload),
    chatCount,
    messageCount,
  };
  const changed =
    legacyToken.length > 0 ||
    record.chatCount !== chatCount ||
    record.messageCount !== messageCount ||
    defaults.ignoreUploadFiles.some((name) => !stringArray(record.ignoreUploadFiles).includes(name)) ||
    defaults.ignoreUploadFolders.some((name) => !stringArray(record.ignoreUploadFolders).includes(name));
  return { settings, legacyToken, changed: raw === undefined ? false : changed };
}

export function isInside(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const fromRoot = relative(resolvedRoot, resolvedTarget);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

export function gistNameToUserPath(userFolder: string, gistName: string): string | null {
  if (!gistName || gistName.includes('\0') || gistName.startsWith(CUSTOM_PREFIX)) return null;
  const parts = splitGistName(gistName);
  if (parts.length === 0 || parts.some((part) => !isSafeSegment(part))) return null;
  if (BLOCKED_FILE_NAMES.has(parts[parts.length - 1])) return null;
  const target = resolve(userFolder, ...parts);
  return isInside(userFolder, target) ? target : null;
}

export function toGistName(userFolder: string, filePath: string): string | null {
  const fromRoot = relative(resolve(userFolder), resolve(filePath));
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  const parts = fromRoot.split(sep).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !isSafeSegment(part))) return null;
  return parts.join('|');
}

export function customFileTarget(mappedPath: string | undefined): string | null {
  if (!mappedPath || mappedPath.includes('\0')) return null;
  const target = resolve(mappedPath);
  return isAbsolute(target) ? target : null;
}

export function workspaceFileTarget(workspaceFolder: string, fileName: string): string | null {
  const base = fileName.split(/[/\\|]/).pop() || '';
  if (!isSafeSegment(base)) return null;
  const target = resolve(workspaceFolder, base);
  return isInside(workspaceFolder, target) ? target : null;
}

export function isExtensionId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(value);
}

export function parseGistId(value: string): string | null {
  const trimmed = value.trim();
  if (/^[a-f0-9]{20,64}$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    return /^[a-f0-9]{20,64}$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

export function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_\-]+$/.test(token) && token.length >= 8 && token.length <= 300;
}

export function apiBase(enterpriseUrl: string): string {
  const trimmed = enterpriseUrl.trim();
  if (!trimmed) return 'https://api.github.com';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('GitHub Enterprise URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('GitHub Enterprise URL must use https.');
  if (url.username || url.password) throw new Error('GitHub Enterprise URL must not include credentials.');
  if (!url.hostname) throw new Error('GitHub Enterprise URL is missing a host.');
  return `${url.origin}/api/v3`;
}

export function sameHostHttps(from: string, location: string): string | null {
  const next = new URL(location, from);
  const prev = new URL(from);
  if (next.protocol !== 'https:' || next.host !== prev.host) return null;
  return next.toString();
}

export function resolveUserFolder(storagePath: string, portable: string | undefined): string {
  if (portable) {
    const user = resolve(portable, 'user-data', 'User');
    if (!isInside(portable, user) || user === resolve(portable)) {
      throw new Error('Could not resolve the portable User folder.');
    }
    return user;
  }

  const storage = resolve(storagePath);
  const root = resolve(storage, '..', '..', '..');
  const user = resolve(root, 'User');
  if (relative(root, user) !== 'User' || relative(resolve(user, 'globalStorage'), storage).startsWith('..')) {
    throw new Error('Could not resolve the editor User folder.');
  }
  return user;
}

export function nameMatches(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const expression = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  return expression.test(name);
}

export function isIgnoredName(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => nameMatches(name, pattern));
}

function splitGistName(gistName: string): string[] {
  if (gistName.includes('|')) return gistName.split('|');
  if (gistName.includes('//')) return gistName.split('//');
  if (gistName.includes('\\')) return gistName.split('\\');
  return [gistName];
}

function isSafeSegment(part: string): boolean {
  if (!part || part === '.' || part === '..') return false;
  if (part.includes('/') || part.includes('\\') || part.includes('|') || part.includes('\0')) return false;
  if (isAbsolute(part) || /^[a-zA-Z]:/.test(part)) return false;
  return true;
}

function mergeStrings(value: unknown, defaults: string[]): string[] {
  const current = stringArray(value);
  const merged = [...current];
  for (const item of defaults) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, mapped] of Object.entries(value as Record<string, unknown>)) {
    if (!isSafeSegment(key) || typeof mapped !== 'string') continue;
    const target = customFileTarget(mapped);
    if (target) result[key] = target;
  }
  return result;
}

function dateString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : value;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
