import { randomBytes } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { RemoteGist } from './github';
import { isInside } from './safe';

export const BUNDLE_NAME = 'settings-sync.json';

export class BundleFormatError extends Error {
  constructor() {
    super('The sync folder file is not valid JSON.');
    this.name = 'BundleFormatError';
  }
}

export function folderIsSafe(userFolder: string, folder: string): boolean {
  const trimmed = folder.trim();
  if (!trimmed || !isAbsolute(trimmed)) return false;
  const target = normalizePath(resolve(trimmed));
  const user = normalizePath(resolve(userFolder));
  if (isInside(user, target)) return false;
  if (isInside(target, user)) return false;
  return true;
}

function normalizePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export function bundlePath(folder: string): string {
  return join(folder, BUNDLE_NAME);
}

export async function readBundle(folder: string): Promise<RemoteGist> {
  let text: string;
  try {
    text = await readFile(bundlePath(folder), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyBundle(folder);
    throw error;
  }
  return parseBundle(folder, text);
}

export async function writeBundle(folder: string, files: Record<string, { content: string } | null>): Promise<void> {
  const kept: Record<string, string> = {};
  for (const [name, file] of Object.entries(files)) {
    if (file) kept[name] = file.content;
  }
  const temporary = join(folder, `${BUNDLE_NAME}.${randomBytes(8).toString('hex')}.tmp`);
  const backup = join(folder, `${BUNDLE_NAME}.${randomBytes(8).toString('hex')}.bak`);
  const destination = bundlePath(folder);
  await writeFile(temporary, `${JSON.stringify({ files: kept }, null, 2)}\n`, 'utf8');

  let moved = false;
  try {
    await rename(destination, backup);
    moved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  try {
    await rename(temporary, destination);
  } catch (error) {
    if (moved) await rename(backup, destination).catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  if (moved) await unlink(backup).catch(() => undefined);
}

function emptyBundle(folder: string): RemoteGist {
  return { id: folder, public: false, description: null, ownerLogin: null, files: {} };
}

function parseBundle(folder: string, text: string): RemoteGist {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BundleFormatError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BundleFormatError();
  const files = (parsed as { files?: unknown }).files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new BundleFormatError();
  const result: Record<string, { content: string }> = {};
  for (const [name, content] of Object.entries(files as Record<string, unknown>)) {
    if (typeof content !== 'string') throw new BundleFormatError();
    result[name] = { content };
  }
  return { id: folder, public: false, description: null, ownerLogin: null, files: result };
}
