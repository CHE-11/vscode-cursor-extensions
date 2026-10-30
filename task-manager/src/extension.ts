import * as vscode from 'vscode';
import { disposeLogger, log } from './logger';
import { ActiveFileTracker, getScope } from './scope';
import { SELECT_TASK_COMMAND, RUN_TASK_COMMAND, StatusBarManager, type TaskPickItem } from './statusBar';
import { TASK_TYPE, buildTask, type TaskManagerDefinition } from './taskFactory';
import { TaskRegistry } from './taskRegistry';
import { TaskRunner } from './taskRunner';
import { watchTasksFiles } from './taskDiscovery';
import { ProjectItem, TaskItem, TasksTreeProvider, type TaskTreeNode, type TreeScopeMode } from './tasksTreeProvider';
import type { ManagedTask, ProjectTasks, ScopeMode } from '../types/tasks';

const VIEW_ID = 'taskManager.tasks';
const TREE_SCOPE_KEY = 'taskManager.treeScope';

type TaskArgument = string | number | TaskTreeNode | ManagedTask | undefined;

function getScopeMode(): ScopeMode {
  return vscode.workspace.getConfiguration('taskManager').get<ScopeMode>('scopeMode') === 'all' ? 'all' : 'activeFile';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function activate(context: vscode.ExtensionContext): void {
  const registry = new TaskRegistry(context);
  const runner = new TaskRunner(registry);
  const statusBar = new StatusBarManager();
  const tracker = new ActiveFileTracker();
  const initialTreeMode = context.workspaceState.get<TreeScopeMode>(TREE_SCOPE_KEY, 'all');
  const tree = new TasksTreeProvider(initialTreeMode);
  const treeView = vscode.window.createTreeView<TaskTreeNode>(VIEW_ID, {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  void vscode.commands.executeCommand('setContext', TREE_SCOPE_KEY, initialTreeMode);

  const render = () => {
    const scope = getScope(registry.projects, tracker.uri, getScopeMode());
    const runningIds = runner.getRunningIds();
    statusBar.render(scope, runningIds, tracker.uri);

    const treeScope = getScope(registry.projects, tracker.uri, 'activeFile');
    tree.update({ allProjects: registry.projects, scope: treeScope, runningIds });
    treeView.description =
      tree.scopeMode === 'active' ? (treeScope.activeProject ? treeScope.activeProject.project.name : 'all projects') : undefined;
    treeView.badge = runningIds.size > 0 ? { value: runningIds.size, tooltip: `${runningIds.size} task(s) running` } : undefined;
  };

  const refresh = () =>
    vscode.window.withProgress({ location: { viewId: VIEW_ID } }, () =>
      registry.refresh().catch((error) => log(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`))
    );

  const resolveTask = (arg: TaskArgument): ManagedTask | undefined => {
    if (arg instanceof TaskItem) {
      return arg.task;
    }
    if (typeof arg === 'string') {
      return registry.getTask(arg);
    }
    if (typeof arg === 'number') {
      // Keybinding support: run the Nth visible status bar task (1-based), like the original extension.
      const scope = getScope(registry.projects, tracker.uri, getScopeMode());
      return scope.projects.flatMap((entry) => entry.tasks).filter((task) => !task.hidden)[arg - 1];
    }
    if (arg && typeof arg === 'object' && 'id' in arg && 'project' in arg) {
      return registry.getTask((arg as ManagedTask).id);
    }
    return undefined;
  };

  const buildPickItems = (): TaskPickItem[] => {
    const scope = getScope(registry.projects, tracker.uri, getScopeMode());
    const inScope = new Set(scope.projects.map((entry) => entry.project.id));
    const ordered: ProjectTasks[] = [
      ...registry.projects.filter((entry) => inScope.has(entry.project.id)),
      ...registry.projects.filter((entry) => !inScope.has(entry.project.id)),
    ];
    const runningIds = runner.getRunningIds();
    const items: TaskPickItem[] = [];
    for (const entry of ordered) {
      if (entry.tasks.length === 0) {
        continue;
      }
      items.push({
        label: entry.project.relativePath || entry.project.name,
        kind: vscode.QuickPickItemKind.Separator,
      });
      for (const task of entry.tasks) {
        items.push({
          label: runningIds.has(task.id) ? `$(sync~spin) ${task.label}` : task.label,
          description: task.statusbar.detail,
          detail: task.commandLine,
          taskId: task.id,
        });
      }
    }
    return items;
  };

  const pickTask = async (placeHolder: string, items?: readonly TaskPickItem[]): Promise<ManagedTask | undefined> => {
    const picked = await vscode.window.showQuickPick(items ?? buildPickItems(), {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return picked?.taskId ? registry.getTask(picked.taskId) : undefined;
  };

  const openTasksFile = async (arg: TaskArgument) => {
    let entry: ProjectTasks | undefined;
    let task: ManagedTask | undefined;
    if (arg instanceof ProjectItem) {
      entry = arg.entry;
    } else if (typeof arg === 'string' && registry.getProject(arg)) {
      entry = registry.getProject(arg);
    } else {
      task = resolveTask(arg);
      entry = task ? registry.getProject(task.project.id) : undefined;
    }
    if (!entry) {
      const picked = await vscode.window.showQuickPick(
        registry.projects.map((project) => ({
          label: project.project.name,
          description: project.project.relativePath,
          entry: project,
        })),
        { placeHolder: 'Select a tasks.json to open' }
      );
      entry = picked?.entry;
    }
    if (!entry) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(entry.project.tasksFileUri);
    const editor = await vscode.window.showTextDocument(document);
    if (task) {
      const key = task.config.label !== undefined ? 'label' : 'script';
      const value = task.config.label ?? task.config.script ?? task.label;
      const match = new RegExp(`"${key}"\\s*:\\s*"${escapeRegExp(value)}"`).exec(document.getText());
      if (match) {
        const position = document.positionAt(match.index);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
  };

  context.subscriptions.push(
    registry,
    runner,
    statusBar,
    tracker,
    tree,
    treeView,

    vscode.commands.registerCommand(RUN_TASK_COMMAND, async (arg: TaskArgument) => {
      const task = resolveTask(arg) ?? (arg === undefined ? await pickTask('Select task to run') : undefined);
      if (!task) {
        if (arg !== undefined) {
          log(`Task not found: ${String(arg)}`);
        }
        return;
      }
      await runner.run(task);
    }),

    vscode.commands.registerCommand('taskManager.stopTask', async (arg: TaskArgument) => {
      const task = resolveTask(arg) ?? (await pickTask('Select task to stop', buildPickItems().filter((item) => !item.taskId || runner.getRunningIds().has(item.taskId))));
      if (task) {
        await runner.stop(task);
      }
    }),

    vscode.commands.registerCommand('taskManager.restartTask', async (arg: TaskArgument) => {
      const task = resolveTask(arg) ?? (await pickTask('Select task to restart'));
      if (task) {
        await runner.restart(task);
      }
    }),

    vscode.commands.registerCommand(SELECT_TASK_COMMAND, async (arg?: string) => {
      const items = arg === 'overflow' ? statusBar.overflowItems : undefined;
      const task = await pickTask('Select task to execute', items);
      if (task) {
        await runner.run(task);
      }
    }),

    vscode.commands.registerCommand('taskManager.openTasksFile', openTasksFile),

    vscode.commands.registerCommand('taskManager.refresh', refresh),

    vscode.commands.registerCommand('taskManager.showAll', async () => {
      tree.setScopeMode('all');
      await context.workspaceState.update(TREE_SCOPE_KEY, 'all');
      await vscode.commands.executeCommand('setContext', TREE_SCOPE_KEY, 'all');
      render();
    }),

    vscode.commands.registerCommand('taskManager.showActiveScope', async () => {
      tree.setScopeMode('active');
      await context.workspaceState.update(TREE_SCOPE_KEY, 'active');
      await vscode.commands.executeCommand('setContext', TREE_SCOPE_KEY, 'active');
      render();
    }),

    vscode.tasks.registerTaskProvider(TASK_TYPE, {
      provideTasks: () =>
        registry.allTasks
          // Workspace-root tasks are already offered by VS Code itself; only add nested ones.
          .filter((task) => task.executable && task.project.relativePath)
          .map((task) => buildTask(task))
          .filter((task): task is vscode.Task => task !== undefined),
      resolveTask: (task) => {
        const definition = task.definition as TaskManagerDefinition;
        const managed = registry.findTaskByDefinition(definition.label, definition.project);
        return managed ? buildTask(managed) : undefined;
      },
    }),

    registry.onDidChange(render),
    runner.onDidChange(render),
    tracker.onDidChange(render),

    watchTasksFiles((change) => {
      if (change.structural) {
        void refresh();
      } else {
        void registry.reload(change.changed);
      }
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('taskManager.exclude') || event.affectsConfiguration('taskManager.statusbar.default.hide')) {
        void refresh();
      } else if (event.affectsConfiguration('taskManager')) {
        render();
      }
    })
  );

  void (async () => {
    const started = Date.now();
    if (await registry.loadCached()) {
      log(`Rendered cached tasks in ${Date.now() - started}ms`);
    }
    await refresh();
    log(`Task Manager ready in ${Date.now() - started}ms`);
  })();
}

export function deactivate(): void {
  disposeLogger();
}
