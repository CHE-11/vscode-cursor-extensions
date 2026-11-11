import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { pathInfo, workspaceRoot } from './paths';

type ExcludeMap = Record<string, boolean | { when: string }>;

interface ExcludePatterns {
  byName: string;
  byNameWithExtension: string;
  allExtension: string;
}

const hideLevels = [
  { regexCode: '**/', includePath: false },
  { regexCode: '*', includePath: true },
  { regexCode: '**/', includePath: true },
  { regexCode: '*/', includePath: true },
] as const;

let previous: ExcludeMap | undefined;

function excludeConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('files', vscode.workspace.workspaceFolders?.[0]);
}

function copyExclude(value: unknown): ExcludeMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as ExcludeMap) };
}

export async function readExclude(): Promise<ExcludeMap> {
  const inspected = excludeConfiguration().inspect<ExcludeMap>('exclude');
  return copyExclude(inspected?.workspaceFolderValue ?? inspected?.workspaceValue);
}

async function writeExclude(next: ExcludeMap): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('Open a folder before changing hidden files.');
  }
  const snapshot = await readExclude();
  await excludeConfiguration().update('exclude', next, vscode.ConfigurationTarget.WorkspaceFolder);
  previous = snapshot;
}

export async function listHidden(): Promise<string[]> {
  return Object.keys(await readExclude());
}

export async function hide(relativePath: string): Promise<void> {
  const current = await readExclude();
  current[relativePath] = true;
  await writeExclude(current);
}

export async function hideMultiple(relativePaths: readonly string[]): Promise<void> {
  const current = await readExclude();
  for (const relativePath of relativePaths) {
    current[relativePath] = true;
  }
  await writeExclude(current);
}

export async function hideBy(relativePath: string, byExtension: boolean, hideLevelIndex: number): Promise<void> {
  const patterns = buildExcludePatterns(relativePath, hideLevelIndex);
  const current = await readExclude();
  if (byExtension) {
    current[patterns.allExtension] = true;
  } else {
    current[patterns.byName] = true;
    current[patterns.byNameWithExtension] = true;
  }
  await writeExclude(current);
}

export async function showOnly(relativePath: string): Promise<void> {
  const target = pathInfo(relativePath);
  const directory = path.join(workspaceRoot(), target.path);
  const names = await fs.readdir(directory);
  const next: ExcludeMap = {};

  for (const fileName of names) {
    const filePath = `${target.path}${fileName}`;
    const current = pathInfo(filePath);
    const patterns = buildExcludePatterns(filePath, 1);
    if (target.filename !== current.filename) {
      next[patterns.byName] = true;
      next[patterns.byNameWithExtension] = true;
    } else if (target.extension) {
      // Same name with an extension: hide the extensionless match and leave the selected file visible.
      next[patterns.byName] = true;
    } else {
      next[patterns.byNameWithExtension] = true;
    }
  }

  await writeExclude(next);
}

export async function makeVisible(pattern: string): Promise<void> {
  const current = await readExclude();
  delete current[pattern];
  await writeExclude(current);
}

export async function showAll(): Promise<void> {
  await writeExclude({});
}

export async function loadExcluded(patterns: readonly string[]): Promise<void> {
  const next: ExcludeMap = {};
  for (const pattern of patterns) {
    next[pattern] = true;
  }
  await writeExclude(next);
}

export async function undo(): Promise<boolean> {
  if (!previous) {
    return false;
  }
  await writeExclude(previous);
  return true;
}

function buildExcludePatterns(itemPath: string, hideLevelIndex: number): ExcludePatterns {
  const level = hideLevels[hideLevelIndex] ?? hideLevels[0];
  const info = pathInfo(itemPath);
  const prefix = level.includePath ? `${info.path}${level.regexCode}` : level.regexCode;
  return {
    byName: `${prefix}${info.filename}`,
    byNameWithExtension: `${prefix}${info.filename}.*`,
    allExtension: `${prefix}*${info.extension}`,
  };
}
