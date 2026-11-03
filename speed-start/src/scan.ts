import type { Dirent } from 'fs';
import { readdir, readFile, realpath, stat } from 'fs/promises';
import path from 'path';
import { isSafelyIgnored, parseIgnore, type ScopedIgnore } from './ignoreMatch';
import { detectSyncMarkers } from './syncRoot';

const FILE_STAT_CONCURRENCY = 32;

export interface WorkspaceRoot {
  fsPath: string;
  name: string;
}

export interface ScanNode {
  kind: 'directory' | 'file';
  relativePath: string;
  absolutePath: string;
  workspaceFsPath: string;
  workspaceName: string;
  fileCount: number;
  byteSize: number;
  ignored: boolean;
  children: ScanNode[];
}

export interface ScanOptions {
  roots: WorkspaceRoot[];
  directoryFileCount: number;
  directoryBytes: number;
  fileBytes: number;
  maxEntries: number;
  maxFilesVisited: number;
  isCancelled?: () => boolean;
  onProgress?: (visited: number) => void;
  onUnreadable?: (absolutePath: string) => void;
}

export interface ScanResult {
  candidates: ScanNode[];
  ignored: ScanNode[];
  capped: boolean;
  cancelled: boolean;
  listCapped: boolean;
  ignoredCapped: boolean;
  visited: number;
  unreadable: number;
  syncMarkers: string[];
}

class DirState {
  fileCount = 0;
  byteSize = 0;
  readonly children: DirState[] = [];
  readonly largeFiles: LargeFile[] = [];

  constructor(
    readonly relativePath: string,
    readonly absolutePath: string,
    readonly name: string,
    readonly workspaceFsPath: string,
    readonly workspaceName: string,
  ) {}
}

interface LargeFile {
  relativePath: string;
  absolutePath: string;
  byteSize: number;
}

interface WalkState {
  visited: number;
  capped: boolean;
  cancelled: boolean;
  unreadable: number;
  ignored: ScanNode[];
  seenRealDirs: Set<string>;
}

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const state: WalkState = {
    visited: 0,
    capped: false,
    cancelled: false,
    unreadable: 0,
    ignored: [],
    seenRealDirs: new Set(),
  };
  const candidates: ScanNode[] = [];

  for (const root of options.roots) {
    if (shouldStop(state, options)) {
      break;
    }
    const rootReal = await directoryRealPath(root.fsPath);
    if (!rootReal) {
      state.unreadable += 1;
      options.onUnreadable?.(root.fsPath);
      continue;
    }
    const dir = new DirState('', root.fsPath, root.name, root.fsPath, root.name);
    await walk(dir, [], rootReal, state, options);
    candidates.push(...collectCandidates(dir, options, true));
  }

  candidates.sort(compareNodes);
  const listCapped = candidates.length > options.maxEntries;
  const ignored = [...state.ignored].sort((left, right) => {
    const byFolder = left.workspaceName.localeCompare(right.workspaceName);
    return byFolder || left.relativePath.localeCompare(right.relativePath);
  });
  const ignoredCapped = ignored.length > options.maxEntries;
  options.onProgress?.(state.visited);

  return {
    candidates: candidates.slice(0, options.maxEntries),
    ignored: ignored.slice(0, options.maxEntries),
    capped: state.capped,
    cancelled: state.cancelled,
    listCapped,
    ignoredCapped,
    visited: state.visited,
    unreadable: state.unreadable,
    syncMarkers: detectSyncMarkers(options.roots.map((root) => root.fsPath)),
  };
}

async function walk(
  dir: DirState,
  parentScopes: ScopedIgnore[],
  rootReal: string,
  state: WalkState,
  options: ScanOptions,
): Promise<void> {
  if (shouldStop(state, options)) {
    return;
  }
  const real = await directoryRealPath(dir.absolutePath);
  if (!real || !isInside(rootReal, real)) {
    if (!real) {
      state.unreadable += 1;
      options.onUnreadable?.(dir.absolutePath);
    }
    return;
  }
  const realKey = normalizeKey(real);
  if (state.seenRealDirs.has(realKey)) {
    return;
  }
  state.seenRealDirs.add(realKey);

  let entries: Dirent[];
  try {
    entries = await readdir(dir.absolutePath, { withFileTypes: true });
  } catch {
    state.unreadable += 1;
    options.onUnreadable?.(dir.absolutePath);
    return;
  }

  const scopes = await scopesForDirectory(dir.absolutePath, dir.relativePath, parentScopes);
  const files: { relativePath: string; absolutePath: string }[] = [];
  const subdirs: { name: string; relativePath: string; absolutePath: string }[] = [];

  for (const entry of entries) {
    state.visited += 1;
    if (state.visited % 2000 === 0) {
      options.onProgress?.(state.visited);
    }
    if (shouldStop(state, options)) {
      break;
    }
    if (entry.name === '.git') {
      continue;
    }

    const absolutePath = path.join(dir.absolutePath, entry.name);
    const relativePath = dir.relativePath ? `${dir.relativePath}/${entry.name}` : entry.name;
    const kind = await entryKind(entry, absolutePath, rootReal);
    if (kind === 'dir') {
      if (isSafelyIgnored(relativePath, true, scopes)) {
        state.ignored.push(ignoredDirectory(relativePath, absolutePath, dir));
        continue;
      }
      subdirs.push({ name: entry.name, relativePath, absolutePath });
    } else if (kind === 'file' && !isSafelyIgnored(relativePath, false, scopes)) {
      files.push({ relativePath, absolutePath });
    }
  }

  const sizes = await mapPool(files, FILE_STAT_CONCURRENCY, async (file) => {
    try {
      return (await stat(file.absolutePath)).size;
    } catch {
      return 0;
    }
  });

  for (let index = 0; index < files.length; index += 1) {
    const size = sizes[index] ?? 0;
    const file = files[index];
    dir.fileCount += 1;
    dir.byteSize += size;
    if (size >= options.fileBytes) {
      dir.largeFiles.push({ relativePath: file.relativePath, absolutePath: file.absolutePath, byteSize: size });
    }
  }

  for (const sub of subdirs) {
    if (shouldStop(state, options)) {
      return;
    }
    const child = new DirState(sub.relativePath, sub.absolutePath, sub.name, dir.workspaceFsPath, dir.workspaceName);
    await walk(child, scopes, rootReal, state, options);
    dir.children.push(child);
    dir.fileCount += child.fileCount;
    dir.byteSize += child.byteSize;
  }
}

function collectCandidates(dir: DirState, options: ScanOptions, isRoot: boolean): ScanNode[] {
  if (!isRoot && isHeavy(dir, options)) {
    return [directoryNode(dir, options)];
  }
  const nodes: ScanNode[] = [];
  for (const child of dir.children) {
    nodes.push(...collectCandidates(child, options, false));
  }
  for (const file of dir.largeFiles) {
    nodes.push(fileNode(file, dir));
  }
  return nodes;
}

function directoryNode(dir: DirState, options: ScanOptions): ScanNode {
  const children: ScanNode[] = [];
  for (const child of dir.children) {
    if (isHeavy(child, options)) {
      children.push(directoryNode(child, options));
    } else {
      children.push(...collectCandidates(child, options, false));
    }
  }
  for (const file of dir.largeFiles) {
    children.push(fileNode(file, dir));
  }
  children.sort(compareNodes);
  return {
    kind: 'directory',
    relativePath: dir.relativePath,
    absolutePath: dir.absolutePath,
    workspaceFsPath: dir.workspaceFsPath,
    workspaceName: dir.workspaceName,
    fileCount: dir.fileCount,
    byteSize: dir.byteSize,
    ignored: false,
    children,
  };
}

function fileNode(file: LargeFile, dir: DirState): ScanNode {
  return {
    kind: 'file',
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    workspaceFsPath: dir.workspaceFsPath,
    workspaceName: dir.workspaceName,
    fileCount: 1,
    byteSize: file.byteSize,
    ignored: false,
    children: [],
  };
}

function ignoredDirectory(relativePath: string, absolutePath: string, dir: DirState): ScanNode {
  return {
    kind: 'directory',
    relativePath,
    absolutePath,
    workspaceFsPath: dir.workspaceFsPath,
    workspaceName: dir.workspaceName,
    fileCount: 0,
    byteSize: 0,
    ignored: true,
    children: [],
  };
}

function isHeavy(dir: DirState, options: ScanOptions): boolean {
  return dir.fileCount >= options.directoryFileCount || dir.byteSize >= options.directoryBytes;
}

function compareNodes(left: ScanNode, right: ScanNode): number {
  if (right.fileCount !== left.fileCount) {
    return right.fileCount - left.fileCount;
  }
  if (right.byteSize !== left.byteSize) {
    return right.byteSize - left.byteSize;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function shouldStop(state: WalkState, options: ScanOptions): boolean {
  if (state.cancelled || state.capped) {
    return true;
  }
  if (options.isCancelled?.()) {
    state.cancelled = true;
    return true;
  }
  if (state.visited >= options.maxFilesVisited) {
    state.capped = true;
    return true;
  }
  return false;
}

async function scopesForDirectory(
  absolutePath: string,
  relativePath: string,
  parent: ScopedIgnore[],
): Promise<ScopedIgnore[]> {
  const local: ScopedIgnore[] = [];
  for (const name of ['.gitignore', '.cursorignore']) {
    try {
      const text = await readFile(path.join(absolutePath, name), 'utf8');
      local.push({ base: relativePath, rules: parseIgnore(text) });
    } catch {
      // The ignore file is optional.
    }
  }
  return local.length > 0 ? parent.concat(local) : parent;
}

async function entryKind(entry: Dirent, absolutePath: string, rootReal: string): Promise<'dir' | 'file' | undefined> {
  if (entry.isSymbolicLink()) {
    try {
      const real = await realpath(absolutePath);
      if (!isInside(rootReal, real)) {
        return undefined;
      }
      const info = await stat(absolutePath);
      if (info.isDirectory()) {
        return 'dir';
      }
      if (info.isFile()) {
        return 'file';
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (entry.isDirectory()) {
    return 'dir';
  }
  if (entry.isFile()) {
    return 'file';
  }
  try {
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      return 'dir';
    }
    if (info.isFile()) {
      return 'file';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function directoryRealPath(absolutePath: string): Promise<string | undefined> {
  try {
    return await realpath(absolutePath);
  } catch {
    return undefined;
  }
}

function isInside(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeKey(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) {
    return results;
  }
  let next = 0;
  const workers = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const current = next;
        next += 1;
        results[current] = await fn(items[current]);
      }
    }),
  );
  return results;
}
