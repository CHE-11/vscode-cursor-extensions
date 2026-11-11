import * as vscode from 'vscode';

export type ProgramKind = 'language' | 'extension' | 'glob' | 'custom';

export interface RunSettings {
  executorMap: Record<string, string>;
  executorMapByFileExtension: Record<string, string>;
  executorMapByGlob: Record<string, string>;
  customCommand: string;
  languageIdToFileExtensionMap: Record<string, string>;
  defaultLanguage: string;
  cwd: string;
  fileDirectoryAsCwd: boolean;
  clearPreviousOutput: boolean;
  saveAllFilesBeforeRun: boolean;
  saveFileBeforeRun: boolean;
  showExecutionMessage: boolean;
  runInTerminal: boolean;
  preserveFocus: boolean;
  ignoreSelection: boolean;
  temporaryFileName: string;
  respectShebang: boolean;
}

export function settingName(kind: ProgramKind): string {
  switch (kind) {
    case 'language':
      return 'executorMap';
    case 'extension':
      return 'executorMapByFileExtension';
    case 'glob':
      return 'executorMapByGlob';
    case 'custom':
      return 'customCommand';
  }
}

export function asMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      map[key] = entry;
    }
  }
  return map;
}

export function readSettings(resource?: vscode.Uri): RunSettings {
  const config = vscode.workspace.getConfiguration('codeRunner', resource);
  return {
    executorMap: asMap(config.get('executorMap')),
    executorMapByFileExtension: asMap(config.get('executorMapByFileExtension')),
    executorMapByGlob: asMap(config.get('executorMapByGlob')),
    customCommand: config.get<string>('customCommand', 'echo Hello'),
    languageIdToFileExtensionMap: asMap(config.get('languageIdToFileExtensionMap')),
    defaultLanguage: config.get<string>('defaultLanguage', ''),
    cwd: config.get<string>('cwd', ''),
    fileDirectoryAsCwd: config.get<boolean>('fileDirectoryAsCwd', false),
    clearPreviousOutput: config.get<boolean>('clearPreviousOutput', false),
    saveAllFilesBeforeRun: config.get<boolean>('saveAllFilesBeforeRun', false),
    saveFileBeforeRun: config.get<boolean>('saveFileBeforeRun', true),
    showExecutionMessage: config.get<boolean>('showExecutionMessage', true),
    runInTerminal: config.get<boolean>('runInTerminal', true),
    preserveFocus: config.get<boolean>('preserveFocus', true),
    ignoreSelection: config.get<boolean>('ignoreSelection', false),
    temporaryFileName: config.get<string>('temporaryFileName', 'tempCodeRunnerFile'),
    respectShebang: config.get<boolean>('respectShebang', true),
  };
}

export interface SettingInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export function scopeMap(
  inspected: SettingInspection<Record<string, string>> | undefined,
  target: vscode.ConfigurationTarget,
): Record<string, string> | undefined {
  const value = scopeRaw(inspected, target);
  if (value === undefined) {
    return undefined;
  }
  return asMap(value);
}

export function scopeRaw<T>(
  inspected: SettingInspection<T> | undefined,
  target: vscode.ConfigurationTarget,
): T | undefined {
  if (!inspected) {
    return undefined;
  }
  if (target === vscode.ConfigurationTarget.Global) {
    return inspected.globalValue;
  }
  if (target === vscode.ConfigurationTarget.Workspace) {
    return inspected.workspaceValue;
  }
  return inspected.workspaceFolderValue;
}

export function mapHasKey(value: unknown, key: string): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string';
}
