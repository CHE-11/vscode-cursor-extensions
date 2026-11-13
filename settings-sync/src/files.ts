import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  CUSTOM_PREFIX,
  FILES,
  type LocalSettings,
  customFileTarget,
  gistNameToUserPath,
  isIgnoredName,
  isInside,
  toGistName,
} from './safe';

export interface SyncFile {
  fileName: string;
  gistName: string;
  content: string;
  absolutePath: string | null;
}

export async function listUserFiles(userFolder: string, local: LocalSettings): Promise<SyncFile[]> {
  const files: SyncFile[] = [];
  await walk(userFolder, userFolder, local, files);
  return files;
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function writeInside(root: string, target: string, content: string): Promise<void> {
  if (!isInside(root, target)) throw new Error('Refused to write outside the User folder.');
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  if (!isInside(root, realDirectory)) throw new Error('Refused to write through a link outside the User folder.');
  const realTarget = resolve(realDirectory, basename(target));
  if (!isInside(root, realTarget)) throw new Error('Refused to write outside the User folder.');
  await writeFile(realTarget, content, 'utf8');
}

export async function writeExact(target: string, content: string): Promise<void> {
  const resolved = customFileTarget(target);
  if (!resolved) throw new Error('Refused to write to an unsafe path.');
  const directory = dirname(resolved);
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  if (!sameDirectory(directory, realDirectory)) {
    throw new Error('Refused to write through a redirected folder.');
  }
  await writeFile(resolved, content, 'utf8');
}

export function downloadTarget(userFolder: string, gistName: string, customFiles: Record<string, string>): string | null {
  if (gistName.startsWith(CUSTOM_PREFIX)) {
    const name = gistName.slice(CUSTOM_PREFIX.length);
    return customFiles[name] ? customFileTarget(customFiles[name]) : null;
  }
  return gistNameToUserPath(userFolder, gistName);
}

async function walk(root: string, directory: string, local: LocalSettings, files: SyncFile[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (isIgnoredName(entry.name, entry.isDirectory() ? local.ignoreUploadFolders : local.ignoreUploadFiles)) continue;
    const full = join(directory, entry.name);
    if (!isInside(root, full)) continue;
    if (entry.isDirectory()) {
      await walk(root, full, local, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1) : '';
    if (!local.supportedFileExtensions.includes(extension)) continue;
    if (entry.name === FILES.extensions || entry.name === FILES.local || entry.name === FILES.lock || entry.name === FILES.keybindingsMac) {
      continue;
    }
    const gistName = toGistName(root, full);
    if (!gistName) continue;
    files.push({
      fileName: entry.name,
      gistName,
      content: await readText(full),
      absolutePath: full,
    });
  }
}

function sameDirectory(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  if (process.platform === 'win32') return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  return resolvedLeft === resolvedRight;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}
