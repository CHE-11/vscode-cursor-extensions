import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './logger';
import type {
  ArgConfig,
  CommandConfig,
  DependsOnConfig,
  GroupConfig,
  ManagedTask,
  PresentationConfig,
  ProjectInfo,
  StatusBarOptions,
  TaskConfig,
  TaskConfigBase,
  TasksFileConfig,
} from '../types/tasks';

export const TASK_TYPE = 'taskManager';

export interface TaskManagerDefinition extends vscode.TaskDefinition {
  type: typeof TASK_TYPE;
  label: string;
  project: string;
}

const IGNORE_GLOBALS = new Set(['tasks', 'version', 'windows', 'osx', 'linux']);
const IGNORE_LOCALS = new Set(['windows', 'osx', 'linux']);

function getPlatformValue(config: TaskConfigBase & { windows?: TaskConfigBase; osx?: TaskConfigBase; linux?: TaskConfigBase }): TaskConfigBase | undefined {
  switch (process.platform) {
    case 'win32':
      return config.windows;
    case 'darwin':
      return config.osx;
    default:
      return config.linux;
  }
}

function deepClone(target: unknown, source: unknown): unknown {
  if (typeof source !== 'object' || source === null) {
    return source;
  }
  if (Array.isArray(source)) {
    return source.slice();
  }
  const result: Record<string, unknown> =
    typeof target === 'object' && target !== null && !Array.isArray(target) ? (target as Record<string, unknown>) : {};
  for (const key of Object.keys(source)) {
    result[key] = deepClone(result[key], (source as Record<string, unknown>)[key]);
  }
  return result;
}

function copyObject(target: Record<string, unknown>, source: object | undefined, ignore?: Set<string>): void {
  if (!source) {
    return;
  }
  for (const key of Object.keys(source)) {
    if (!ignore || !ignore.has(key)) {
      target[key] = deepClone(target[key], (source as Record<string, unknown>)[key]);
    }
  }
}

/**
 * Merges file-level settings, file-level platform settings, task settings and task platform
 * settings in the same order VS Code applies them.
 */
export function computeTaskInfo(task: TaskConfig, fileConfig: TasksFileConfig): TaskConfig {
  const merged: Record<string, unknown> = {};
  copyObject(merged, fileConfig, IGNORE_GLOBALS);
  copyObject(merged, getPlatformValue(fileConfig));
  copyObject(merged, task, IGNORE_LOCALS);
  copyObject(merged, getPlatformValue(task));
  const info = merged as TaskConfig;
  if (info.type === undefined) {
    info.type = 'process';
  }
  return info;
}

function getTaskLabel(info: TaskConfig): string | undefined {
  if (typeof info.label === 'string' && info.label) {
    return info.label;
  }
  if (info.type === 'npm' && info.script) {
    return info.path ? `npm: ${info.script} - ${info.path}` : `npm: ${info.script}`;
  }
  return undefined;
}

function normalizeDependsOn(dependsOn: DependsOnConfig | undefined): string[] {
  if (dependsOn === undefined) {
    return [];
  }
  const list = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  const labels: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      labels.push(entry);
    } else if (entry && typeof entry === 'object') {
      const label = entry.label ?? entry.task;
      if (typeof label === 'string') {
        labels.push(label);
      }
    }
  }
  return labels;
}

function resolveStatusBarOptions(info: TaskConfig): StatusBarOptions {
  const statusbar: StatusBarOptions = { ...(info.options?.statusbar ?? {}) };
  if (statusbar.detail === undefined && info.detail !== undefined) {
    statusbar.detail = info.detail;
  }
  if (statusbar.icon === undefined && info.icon !== undefined) {
    statusbar.icon = info.icon;
  }
  return statusbar;
}

function isTaskHidden(info: TaskConfig, statusbar: StatusBarOptions): boolean {
  if (typeof statusbar.hide === 'boolean') {
    return statusbar.hide;
  }
  if (typeof info.hide === 'boolean') {
    return info.hide;
  }
  return vscode.workspace.getConfiguration('taskManager.statusbar.default').get<boolean>('hide') ?? false;
}

function isExecutable(info: TaskConfig): boolean {
  if (info.type === 'npm') {
    return typeof info.script === 'string' && info.script.length > 0;
  }
  if (info.type === 'shell' || info.type === 'process') {
    return info.command !== undefined && info.command !== '';
  }
  return false;
}

function argToString(arg: ArgConfig): string {
  return typeof arg === 'string' ? arg : arg.value;
}

function commandToString(command: CommandConfig | undefined): string {
  if (command === undefined) {
    return '';
  }
  if (Array.isArray(command)) {
    return command.map(argToString).join(' ');
  }
  return argToString(command);
}

function getNpmFolder(project: ProjectInfo, info: TaskConfig): string {
  return info.path ? path.join(project.folderUri.fsPath, info.path) : project.folderUri.fsPath;
}

const packageManagerCache = new Map<string, string>();

export function clearPackageManagerCache(): void {
  packageManagerCache.clear();
}

/**
 * Picks the package manager from the closest lockfile, walking up to the workspace folder.
 */
export function detectPackageManager(folder: string, stopAt: string): string {
  const cached = packageManagerCache.get(folder);
  if (cached) {
    return cached;
  }
  let current = folder;
  let result = 'npm';
  const stop = path.resolve(stopAt);
  for (;;) {
    if (fs.existsSync(path.join(current, 'pnpm-lock.yaml'))) {
      result = 'pnpm';
      break;
    }
    if (fs.existsSync(path.join(current, 'yarn.lock'))) {
      result = 'yarn';
      break;
    }
    if (fs.existsSync(path.join(current, 'bun.lockb')) || fs.existsSync(path.join(current, 'bun.lock'))) {
      result = 'bun';
      break;
    }
    if (fs.existsSync(path.join(current, 'package-lock.json'))) {
      result = 'npm';
      break;
    }
    const parent = path.dirname(current);
    if (parent === current || path.resolve(current) === stop) {
      break;
    }
    current = parent;
  }
  packageManagerCache.set(folder, result);
  return result;
}

function npmCommandLine(packageManager: string, script: string): string {
  if (script === 'install') {
    return `${packageManager} install`;
  }
  return `${packageManager} run ${script}`;
}

function describeCommandLine(project: ProjectInfo, info: TaskConfig): string {
  if (info.type === 'npm' && info.script) {
    const folder = getNpmFolder(project, info);
    return npmCommandLine(detectPackageManager(folder, project.workspaceFolder.uri.fsPath), info.script);
  }
  const command = commandToString(info.command);
  const args = (info.args ?? []).map(argToString).join(' ');
  return args ? `${command} ${args}` : command;
}

/**
 * Turns a parsed tasks.json into managed tasks for one project folder.
 */
export function createProjectTasks(project: ProjectInfo, fileConfig: TasksFileConfig): ManagedTask[] {
  if (typeof fileConfig !== 'object' || fileConfig === null || !Array.isArray(fileConfig.tasks)) {
    return [];
  }
  const tasks: ManagedTask[] = [];
  const seenIds = new Set<string>();

  fileConfig.tasks.forEach((taskConfig, index) => {
    if (typeof taskConfig !== 'object' || taskConfig === null) {
      return;
    }
    const info = computeTaskInfo(taskConfig, fileConfig);
    const label = getTaskLabel(info);
    if (!label) {
      log(`Skipping task #${index + 1} in ${project.tasksFileUri.fsPath}: it has no label`);
      return;
    }
    let id = `${project.id}::${label}`;
    if (seenIds.has(id)) {
      id = `${id}#${index}`;
    }
    seenIds.add(id);

    const statusbar = resolveStatusBarOptions(info);
    const executable = isExecutable(info);
    const dependsOn = normalizeDependsOn(info.dependsOn);
    if (!executable && dependsOn.length === 0) {
      log(`Task "${label}" in ${project.name} has unsupported type "${info.type}" and no dependsOn; it will be listed but cannot run`);
    }

    tasks.push({
      id,
      label,
      project,
      config: info,
      index,
      executable,
      isBackground: info.isBackground === true,
      dependsOn,
      dependsOrder: info.dependsOrder === 'sequence' ? 'sequence' : 'parallel',
      statusbar,
      hidden: isTaskHidden(info, statusbar),
      commandLine: executable ? describeCommandLine(project, info) : dependsOn.length ? `dependsOn: ${dependsOn.join(', ')}` : '',
    });
  });

  return tasks;
}

interface VariableContext {
  project: ProjectInfo;
  editor: vscode.TextEditor | undefined;
}

function resolveVariable(name: string, ctx: VariableContext): string | undefined {
  const projectFolder = ctx.project.folderUri.fsPath;
  if (name.startsWith('env:')) {
    return process.env[name.slice(4)] ?? '';
  }

  switch (name) {
    case 'workspaceFolder':
    case 'workspaceRoot':
    case 'fileWorkspaceFolder':
    case 'cwd':
      return projectFolder;
    case 'workspaceFolderBasename':
      return path.basename(projectFolder);
    case 'userHome':
      return os.homedir();
    case 'pathSeparator':
    case '/':
      return path.sep;
  }

  const document = ctx.editor?.document;
  if (!document || document.uri.scheme !== 'file') {
    return undefined;
  }
  const file = document.uri.fsPath;
  const relativeFile = path.relative(projectFolder, file);

  switch (name) {
    case 'file':
      return file;
    case 'fileBasename':
      return path.basename(file);
    case 'fileBasenameNoExtension':
      return path.basename(file, path.extname(file));
    case 'fileExtname':
      return path.extname(file);
    case 'fileDirname':
      return path.dirname(file);
    case 'fileDirnameBasename':
      return path.basename(path.dirname(file));
    case 'relativeFile':
      return relativeFile;
    case 'relativeFileDirname':
      return path.dirname(relativeFile);
    case 'lineNumber':
      return String((ctx.editor?.selection.active.line ?? 0) + 1);
    case 'selectedText':
      return ctx.editor ? document.getText(ctx.editor.selection) : '';
  }

  // Anything else (${input:...}, ${config:...}, ${command:...}) is left for VS Code to resolve.
  return undefined;
}

function substitute(value: string, ctx: VariableContext): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => resolveVariable(name, ctx) ?? match);
}

function substituteDeep<T>(value: T, ctx: VariableContext): T {
  if (typeof value === 'string') {
    return substitute(value, ctx) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, ctx)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = substituteDeep(item, ctx);
    }
    return result as T;
  }
  return value;
}

const QUOTING: Record<string, vscode.ShellQuoting> = {
  escape: vscode.ShellQuoting.Escape,
  strong: vscode.ShellQuoting.Strong,
  weak: vscode.ShellQuoting.Weak,
};

function toShellArg(arg: ArgConfig): string | vscode.ShellQuotedString {
  if (typeof arg === 'string') {
    return arg;
  }
  return { value: arg.value, quoting: QUOTING[arg.quoting ?? 'escape'] ?? vscode.ShellQuoting.Escape };
}

function resolveCwd(project: ProjectInfo, cwd: string | undefined): string {
  if (!cwd) {
    return project.folderUri.fsPath;
  }
  return path.isAbsolute(cwd) ? cwd : path.join(project.folderUri.fsPath, cwd);
}

function createExecution(managed: ManagedTask, info: TaskConfig): vscode.ShellExecution | vscode.ProcessExecution | undefined {
  const { project } = managed;
  const cwd = resolveCwd(project, info.options?.cwd);
  const env = info.options?.env;

  if (info.type === 'npm' && info.script) {
    const folder = getNpmFolder(project, info);
    const packageManager = detectPackageManager(folder, project.workspaceFolder.uri.fsPath);
    return new vscode.ShellExecution(npmCommandLine(packageManager, info.script), { cwd: folder, env });
  }

  if (info.type === 'shell') {
    const shellOptions: vscode.ShellExecutionOptions = {
      cwd,
      env,
      executable: info.options?.shell?.executable,
      shellArgs: info.options?.shell?.args,
    };
    const args = info.args ?? [];
    if (Array.isArray(info.command)) {
      const [first, ...rest] = info.command;
      if (first === undefined) {
        return undefined;
      }
      return new vscode.ShellExecution(toShellArg(first), [...rest, ...args].map(toShellArg), shellOptions);
    }
    if (info.command === undefined) {
      return undefined;
    }
    if (args.length === 0) {
      return new vscode.ShellExecution(argToString(info.command), shellOptions);
    }
    return new vscode.ShellExecution(toShellArg(info.command), args.map(toShellArg), shellOptions);
  }

  if (info.type === 'process') {
    const command = Array.isArray(info.command) ? info.command[0] : info.command;
    if (command === undefined) {
      return undefined;
    }
    const extraArgs = Array.isArray(info.command) ? info.command.slice(1) : [];
    return new vscode.ProcessExecution(argToString(command), [...extraArgs, ...(info.args ?? [])].map(argToString), { cwd, env });
  }

  return undefined;
}

const REVEAL: Record<string, vscode.TaskRevealKind> = {
  always: vscode.TaskRevealKind.Always,
  silent: vscode.TaskRevealKind.Silent,
  never: vscode.TaskRevealKind.Never,
};

const PANEL: Record<string, vscode.TaskPanelKind> = {
  shared: vscode.TaskPanelKind.Shared,
  dedicated: vscode.TaskPanelKind.Dedicated,
  new: vscode.TaskPanelKind.New,
};

function createPresentation(presentation: PresentationConfig | undefined): vscode.TaskPresentationOptions {
  if (!presentation) {
    return {};
  }
  return {
    reveal: presentation.reveal ? REVEAL[presentation.reveal] : undefined,
    panel: presentation.panel ? PANEL[presentation.panel] : undefined,
    echo: presentation.echo,
    focus: presentation.focus,
    showReuseMessage: presentation.showReuseMessage,
    clear: presentation.clear,
    close: presentation.close,
  };
}

const GROUPS: Record<string, vscode.TaskGroup> = {
  build: vscode.TaskGroup.Build,
  test: vscode.TaskGroup.Test,
  clean: vscode.TaskGroup.Clean,
  rebuild: vscode.TaskGroup.Rebuild,
};

function createGroup(group: GroupConfig | undefined): vscode.TaskGroup | undefined {
  if (!group) {
    return undefined;
  }
  const kind = typeof group === 'string' ? group : group.kind;
  return GROUPS[kind];
}

function getProblemMatchers(info: TaskConfig): string[] {
  const matcher = info.problemMatcher;
  if (matcher === undefined) {
    return [];
  }
  const list = Array.isArray(matcher) ? matcher : [matcher];
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      names.push(entry);
    } else if (entry && typeof entry === 'object' && typeof (entry as { base?: unknown }).base === 'string') {
      names.push((entry as { base: string }).base);
    }
  }
  return names;
}

export function createDefinition(managed: ManagedTask): TaskManagerDefinition {
  return { type: TASK_TYPE, label: managed.label, project: managed.project.folderUri.fsPath };
}

/**
 * Builds a runnable vscode.Task. Variables are resolved now so `${file}` reflects the current editor.
 */
export function buildTask(managed: ManagedTask): vscode.Task | undefined {
  if (!managed.executable) {
    return undefined;
  }
  const info = substituteDeep(managed.config, { project: managed.project, editor: vscode.window.activeTextEditor });
  const execution = createExecution(managed, info);
  if (!execution) {
    return undefined;
  }
  const task = new vscode.Task(
    createDefinition(managed),
    managed.project.workspaceFolder,
    managed.label,
    managed.project.name,
    execution,
    getProblemMatchers(info)
  );
  task.isBackground = managed.isBackground;
  task.presentationOptions = createPresentation(info.presentation);
  task.detail = info.detail ?? managed.commandLine;
  const group = createGroup(info.group);
  if (group) {
    task.group = group;
  }
  return task;
}
