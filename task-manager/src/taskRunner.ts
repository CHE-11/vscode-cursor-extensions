import * as vscode from 'vscode';
import { log } from './logger';
import { TASK_TYPE, buildTask, type TaskManagerDefinition } from './taskFactory';
import type { TaskRegistry } from './taskRegistry';
import { normalizePath } from './scope';
import type { ManagedTask } from '../types/tasks';

const RESTART_TIMEOUT_MS = 5000;

export class TaskRunner implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  /** Compound (dependsOn-only) tasks currently running their dependencies. */
  private readonly runningCompounds = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly registry: TaskRegistry) {
    this.disposables.push(
      vscode.tasks.onDidStartTask(() => this.changeEmitter.fire()),
      vscode.tasks.onDidEndTask(() => this.changeEmitter.fire())
    );
  }

  /** Maps a running VS Code task execution back to the managed task it belongs to. */
  resolveExecution(execution: vscode.TaskExecution): ManagedTask | undefined {
    const task = execution.task;
    if (task.definition.type === TASK_TYPE) {
      const definition = task.definition as TaskManagerDefinition;
      return this.registry.findTaskByDefinition(definition.label, definition.project);
    }
    // Tasks from a workspace folder's own tasks.json can also be started through the built-in
    // "Run Task" picker; match them to the root project so their running state still shows.
    if (task.source === 'Workspace' && task.scope && typeof task.scope === 'object') {
      const folder = task.scope as vscode.WorkspaceFolder;
      const project = this.registry.getProject(normalizePath(folder.uri.fsPath));
      return project?.tasks.find((managed) => managed.label === task.name);
    }
    return undefined;
  }

  getExecutions(managed: ManagedTask): vscode.TaskExecution[] {
    return vscode.tasks.taskExecutions.filter((execution) => this.resolveExecution(execution)?.id === managed.id);
  }

  isRunning(managed: ManagedTask): boolean {
    return this.runningCompounds.has(managed.id) || this.getExecutions(managed).length > 0;
  }

  getRunningIds(): Set<string> {
    const ids = new Set(this.runningCompounds);
    for (const execution of vscode.tasks.taskExecutions) {
      const managed = this.resolveExecution(execution);
      if (managed) {
        ids.add(managed.id);
      }
    }
    return ids;
  }

  async run(managed: ManagedTask): Promise<void> {
    try {
      await this.runWithDependencies(managed, new Set(), false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Task "${managed.label}" failed: ${message}`);
      void vscode.window.showWarningMessage(`Task Manager: ${message}`);
    }
  }

  async stop(managed: ManagedTask): Promise<void> {
    const executions = this.collectExecutions(managed, new Set());
    for (const execution of executions) {
      execution.terminate();
    }
    this.runningCompounds.delete(managed.id);
    this.changeEmitter.fire();
  }

  async restart(managed: ManagedTask): Promise<void> {
    const executions = this.collectExecutions(managed, new Set());
    if (executions.length > 0) {
      const ended = this.waitForEnd(executions);
      for (const execution of executions) {
        execution.terminate();
      }
      await ended;
    }
    this.runningCompounds.delete(managed.id);
    await this.run(managed);
  }

  private collectExecutions(managed: ManagedTask, visited: Set<string>): vscode.TaskExecution[] {
    if (visited.has(managed.id)) {
      return [];
    }
    visited.add(managed.id);
    const executions = this.getExecutions(managed);
    if (!managed.executable) {
      for (const dependency of this.resolveDependencies(managed)) {
        executions.push(...this.collectExecutions(dependency, visited));
      }
    }
    return executions;
  }

  private resolveDependencies(managed: ManagedTask): ManagedTask[] {
    const dependencies: ManagedTask[] = [];
    for (const label of managed.dependsOn) {
      const dependency = this.registry.findTaskByLabel(managed.project, label);
      if (!dependency) {
        throw new Error(`Task "${managed.label}" depends on "${label}", which was not found in ${managed.project.name}/.vscode/tasks.json`);
      }
      dependencies.push(dependency);
    }
    return dependencies;
  }

  private async runWithDependencies(managed: ManagedTask, stack: Set<string>, wait: boolean): Promise<void> {
    if (stack.has(managed.id)) {
      throw new Error(`Circular dependsOn detected at "${managed.label}"`);
    }
    const nextStack = new Set(stack).add(managed.id);
    const dependencies = this.resolveDependencies(managed);

    if (!managed.executable) {
      this.runningCompounds.add(managed.id);
      this.changeEmitter.fire();
    }

    try {
      if (managed.dependsOrder === 'sequence') {
        for (const dependency of dependencies) {
          await this.runWithDependencies(dependency, nextStack, true);
        }
      } else {
        await Promise.all(dependencies.map((dependency) => this.runWithDependencies(dependency, nextStack, true)));
      }
    } finally {
      if (!managed.executable) {
        this.runningCompounds.delete(managed.id);
        this.changeEmitter.fire();
      }
    }

    if (!managed.executable) {
      if (dependencies.length === 0) {
        throw new Error(`Task "${managed.label}" has no command and its type "${managed.config.type}" is not supported`);
      }
      return;
    }

    const task = buildTask(managed);
    if (!task) {
      throw new Error(`Could not build task "${managed.label}"`);
    }
    log(`Running "${managed.label}" (${managed.project.relativePath || managed.project.name}): ${managed.commandLine}`);
    const execution = await vscode.tasks.executeTask(task);
    if (wait && !managed.isBackground) {
      const exitCode = await this.waitForExit(execution);
      if (exitCode !== undefined && exitCode !== 0) {
        throw new Error(`Dependency "${managed.label}" exited with code ${exitCode}`);
      }
    }
  }

  private waitForExit(execution: vscode.TaskExecution): Promise<number | undefined> {
    return new Promise((resolve) => {
      const isSame = (other: vscode.TaskExecution) =>
        other === execution || this.resolveExecution(other)?.id === this.resolveExecution(execution)?.id;
      const disposables: vscode.Disposable[] = [];
      const finish = (code: number | undefined) => {
        disposables.forEach((disposable) => disposable.dispose());
        resolve(code);
      };
      disposables.push(
        vscode.tasks.onDidEndTaskProcess((event) => {
          if (isSame(event.execution)) {
            finish(event.exitCode);
          }
        }),
        vscode.tasks.onDidEndTask((event) => {
          if (isSame(event.execution)) {
            finish(undefined);
          }
        })
      );
    });
  }

  private waitForEnd(executions: vscode.TaskExecution[]): Promise<void> {
    return new Promise((resolve) => {
      const pending = new Set(executions);
      const timer = setTimeout(done, RESTART_TIMEOUT_MS);
      const listener = vscode.tasks.onDidEndTask((event) => {
        pending.delete(event.execution);
        for (const execution of [...pending]) {
          if (!vscode.tasks.taskExecutions.includes(execution)) {
            pending.delete(execution);
          }
        }
        if (pending.size === 0) {
          done();
        }
      });
      function done() {
        clearTimeout(timer);
        listener.dispose();
        resolve();
      }
    });
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.changeEmitter.dispose();
  }
}
