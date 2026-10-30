import * as vscode from 'vscode';
import * as path from 'path';
import { parseJsonc } from './jsonc';
import { log } from './logger';
import { clearPackageManagerCache, createProjectTasks } from './taskFactory';
import { findTasksFiles } from './taskDiscovery';
import { normalizePath } from './scope';
import type { ManagedTask, ProjectInfo, ProjectTasks, TasksFileConfig } from '../types/tasks';

const CACHE_KEY = 'taskManager.tasksFiles';

function createProjectInfo(tasksFileUri: vscode.Uri): ProjectInfo | undefined {
  const folderUri = vscode.Uri.file(path.dirname(path.dirname(tasksFileUri.fsPath)));
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(tasksFileUri);
  if (!workspaceFolder) {
    return undefined;
  }
  const relativePath = path.relative(workspaceFolder.uri.fsPath, folderUri.fsPath).split(path.sep).join('/');
  return {
    id: normalizePath(folderUri.fsPath),
    name: relativePath ? path.basename(folderUri.fsPath) : workspaceFolder.name,
    folderUri,
    tasksFileUri,
    workspaceFolder,
    relativePath,
  };
}

/**
 * Root projects first, then nested projects sorted by path; workspace folders keep their order.
 */
function compareProjects(a: ProjectInfo, b: ProjectInfo): number {
  if (a.workspaceFolder.index !== b.workspaceFolder.index) {
    return a.workspaceFolder.index - b.workspaceFolder.index;
  }
  if (!a.relativePath) {
    return -1;
  }
  if (!b.relativePath) {
    return 1;
  }
  return a.relativePath.localeCompare(b.relativePath);
}

export class TaskRegistry implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private projectMap = new Map<string, ProjectTasks>();
  private sorted: ProjectTasks[] = [];
  private generation = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get projects(): readonly ProjectTasks[] {
    return this.sorted;
  }

  get allTasks(): ManagedTask[] {
    return this.sorted.flatMap((entry) => entry.tasks);
  }

  getTask(id: string): ManagedTask | undefined {
    for (const entry of this.sorted) {
      const found = entry.tasks.find((task) => task.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  getProject(id: string): ProjectTasks | undefined {
    return this.projectMap.get(id);
  }

  findTaskByLabel(project: ProjectInfo, label: string): ManagedTask | undefined {
    return this.projectMap.get(project.id)?.tasks.find((task) => task.label === label);
  }

  findTaskByDefinition(label: string, projectFolder: string): ManagedTask | undefined {
    return this.projectMap.get(normalizePath(projectFolder))?.tasks.find((task) => task.label === label);
  }

  /**
   * Loads the tasks.json files found in the previous session so the UI is populated before the
   * full workspace search finishes.
   */
  async loadCached(): Promise<boolean> {
    const cached = this.context.workspaceState.get<string[]>(CACHE_KEY);
    if (!cached?.length) {
      return false;
    }
    await this.loadFiles(cached.map((file) => vscode.Uri.parse(file)), false);
    return this.sorted.length > 0;
  }

  /** Full rescan of the workspace for nested tasks.json files. */
  async refresh(): Promise<void> {
    clearPackageManagerCache();
    const files = await findTasksFiles();
    await this.loadFiles(files, true);
  }

  /** Reparses only the given files, keeping every other project as-is. */
  async reload(files: vscode.Uri[]): Promise<void> {
    const generation = this.generation;
    const results = await Promise.all(files.map((file) => this.readProject(file)));
    if (generation !== this.generation) {
      return;
    }
    for (const result of results) {
      if (result) {
        this.projectMap.set(result.project.id, result);
      }
    }
    this.publish();
  }

  private async loadFiles(files: vscode.Uri[], persist: boolean): Promise<void> {
    const generation = ++this.generation;
    const results = await Promise.all(files.map((file) => this.readProject(file)));
    if (generation !== this.generation) {
      return;
    }
    this.projectMap = new Map();
    for (const result of results) {
      if (result) {
        this.projectMap.set(result.project.id, result);
      }
    }
    this.publish();
    if (persist) {
      await this.context.workspaceState.update(
        CACHE_KEY,
        this.sorted.map((entry) => entry.project.tasksFileUri.toString())
      );
    }
  }

  private async readProject(tasksFileUri: vscode.Uri): Promise<ProjectTasks | undefined> {
    const project = createProjectInfo(tasksFileUri);
    if (!project) {
      return undefined;
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(tasksFileUri);
    } catch {
      return undefined;
    }
    try {
      const config = parseJsonc<TasksFileConfig>(Buffer.from(bytes).toString('utf8'));
      const tasks = createProjectTasks(project, config);
      log(`Loaded ${tasks.length} task(s) from ${project.relativePath || project.name}`);
      return { project, tasks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to parse ${tasksFileUri.fsPath}: ${message}`);
      return { project, tasks: [], error: message };
    }
  }

  private publish(): void {
    this.sorted = [...this.projectMap.values()].sort((a, b) => compareProjects(a.project, b.project));
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
