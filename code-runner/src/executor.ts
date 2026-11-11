import * as path from 'node:path';

export type ExecutorSource = 'explicit' | 'glob' | 'shebang' | 'language' | 'extension' | 'default' | 'none';

export interface ExecutorQuery {
  baseName: string;
  languageId: string;
  fileExtension: string;
  firstLine: string;
  languageIdOverride?: string;
  respectShebang: boolean;
  executorMap: Record<string, string>;
  executorMapByGlob: Record<string, string>;
  executorMapByFileExtension: Record<string, string>;
  defaultLanguage: string;
}

export interface ResolvedExecutor {
  command: string | undefined;
  languageId: string;
  source: ExecutorSource;
}

export interface PlaceholderContext {
  workspaceRoot: string;
  dir: string;
  dirWithoutTrailingSlash: string;
  fullFileName: string;
  fileName: string;
  fileNameWithoutExt: string;
  driveLetter: string;
  pythonPath: string;
}

const PLACEHOLDER = /\$(?:workspaceRoot|dirWithoutTrailingSlash|dir|fullFileName|fileNameWithoutExt|fileName|driveLetter|pythonPath)/;

export function matchGlob(fileName: string, pattern: string): boolean {
  let expression = '^';
  for (const char of pattern) {
    if (char === '*') {
      expression += '.*';
    } else if (char === '?') {
      expression += '.';
    } else {
      expression += char.replace(/[\\^$+.|(){}[\]]/g, '\\$&');
    }
  }
  expression += '$';
  return new RegExp(expression).test(fileName);
}

export function resolveExecutor(query: ExecutorQuery): ResolvedExecutor {
  if (query.languageIdOverride) {
    const languageId = query.languageIdOverride;
    const command = query.executorMap[languageId];
    return { command, languageId, source: command ? 'explicit' : 'none' };
  }

  for (const pattern of Object.keys(query.executorMapByGlob)) {
    if (matchGlob(query.baseName, pattern)) {
      return { command: query.executorMapByGlob[pattern], languageId: query.languageId, source: 'glob' };
    }
  }

  if (query.respectShebang) {
    const shebang = /^#!(?!\[)(.*)$/.exec(query.firstLine);
    const command = shebang?.[1]?.trim();
    if (command) {
      return { command, languageId: query.languageId, source: 'shebang' };
    }
  }

  const byLanguage = query.executorMap[query.languageId];
  if (byLanguage) {
    return { command: byLanguage, languageId: query.languageId, source: 'language' };
  }

  if (query.fileExtension) {
    const byExtension = query.executorMapByFileExtension[query.fileExtension];
    if (byExtension) {
      return { command: byExtension, languageId: query.fileExtension, source: 'extension' };
    }
  }

  if (query.defaultLanguage) {
    const command = query.executorMap[query.defaultLanguage];
    if (command) {
      return { command, languageId: query.defaultLanguage, source: 'default' };
    }
  }

  return { command: undefined, languageId: query.languageId, source: 'none' };
}

export function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function placeholderContext(filePath: string, workspaceRoot: string, pythonPath: string): PlaceholderContext {
  const normalized = filePath.replace(/\\/g, '/');
  const parsed = path.posix.parse(normalized);
  const root = (workspaceRoot || parsed.dir).replace(/\\/g, '/').replace(/\/+$/, '');
  const drive = /^([A-Za-z]:)/.exec(normalized)?.[1] ?? '';
  return {
    workspaceRoot: root,
    dir: parsed.dir ? `${parsed.dir}/` : '',
    dirWithoutTrailingSlash: parsed.dir,
    fullFileName: normalized,
    fileName: parsed.base,
    fileNameWithoutExt: parsed.name,
    driveLetter: drive,
    pythonPath: (pythonPath || 'python').replace(/\\/g, '/'),
  };
}

/**
 * Fills placeholders. Paths are quoted. `$dir$fileNameWithoutExt` becomes one quoted path.
 * A command with no placeholder gets the quoted full path appended when `appendFile` is set.
 */
export function buildCommand(executor: string, ctx: PlaceholderContext | undefined, appendFile: boolean): string {
  if (!ctx) {
    return executor;
  }
  const hasPlaceholder = PLACEHOLDER.test(executor);
  const compiled = joinPosix(ctx.dirWithoutTrailingSlash, ctx.fileNameWithoutExt);
  let command = executor.replace(/\$dir\$fileNameWithoutExt/g, () => quote(compiled));
  const replacements: Array<[RegExp, string]> = [
    [/\$dirWithoutTrailingSlash/g, quote(ctx.dirWithoutTrailingSlash)],
    [/\$fullFileName/g, quote(ctx.fullFileName)],
    [/\$fileNameWithoutExt/g, quote(ctx.fileNameWithoutExt)],
    [/\$workspaceRoot/g, quote(ctx.workspaceRoot)],
    [/\$fileName/g, quote(ctx.fileName)],
    [/\$driveLetter/g, ctx.driveLetter],
    [/\$dir/g, quote(ctx.dir)],
    [/\$pythonPath/g, quote(ctx.pythonPath)],
  ];
  for (const [pattern, value] of replacements) {
    command = command.replace(pattern, () => value);
  }
  if (!hasPlaceholder && appendFile) {
    command += ` ${quote(ctx.fullFileName)}`;
  }
  return command;
}

/** Rewrites `&&` chains for Windows PowerShell before placeholders are filled. */
export function toPowerShell(executor: string): string {
  if (!executor.includes(' && ')) {
    return executor;
  }
  let command = executor.replace('&&', () => '; if ($?) {');
  command = command.replace(/&&/g, () => '} ; if ($?) {');
  command = command.replace(/\$dir\$fileNameWithoutExt/g, () => '.\\$fileNameWithoutExt');
  return `${command} }`;
}

function joinPosix(dir: string, name: string): string {
  if (!dir) {
    return name;
  }
  return `${dir.replace(/\/+$/, '')}/${name}`;
}
