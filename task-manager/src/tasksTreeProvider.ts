import * as vscode from 'vscode';
import type { TaskScope } from './scope';
import type { ManagedTask, ProjectTasks } from '../types/tasks';

export class ProjectItem extends vscode.TreeItem {
  readonly kind = 'project' as const;

  constructor(readonly entry: ProjectTasks, isActive: boolean, runningCount: number) {
    super(entry.project.name, vscode.TreeItemCollapsibleState.Expanded);
    const { project } = entry;
    this.id = `project:${project.id}`;
    this.contextValue = 'project';
    this.resourceUri = project.folderUri;

    const parts: string[] = [];
    if (project.relativePath && project.relativePath !== project.name) {
      parts.push(project.relativePath);
    } else if (!project.relativePath) {
      parts.push('workspace root');
    }
    if (isActive) {
      parts.push('(active)');
    }
    if (runningCount > 0) {
      parts.push(`${runningCount} running`);
    }
    if (entry.error) {
      parts.push('invalid tasks.json');
    }
    this.description = parts.join(' · ');

    if (entry.error) {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    } else if (isActive) {
      this.iconPath = new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('charts.blue'));
    } else {
      this.iconPath = new vscode.ThemeIcon(project.relativePath ? 'folder' : 'root-folder');
    }

    const tooltip = new vscode.MarkdownString(
      [
        `**${project.name}**`,
        `\`${project.tasksFileUri.fsPath}\``,
        `${entry.tasks.length} task(s)`,
        entry.error ? `$(warning) ${entry.error}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
    tooltip.supportThemeIcons = true;
    this.tooltip = tooltip;
  }
}

export class TaskItem extends vscode.TreeItem {
  readonly kind = 'task' as const;

  constructor(readonly task: ManagedTask, running: boolean) {
    super(task.label, vscode.TreeItemCollapsibleState.None);
    this.id = `task:${task.id}`;
    this.contextValue = running ? 'runningTask' : 'task';

    const descriptionParts: string[] = [];
    if (running) {
      descriptionParts.push('running');
    }
    if (task.statusbar.detail) {
      descriptionParts.push(task.statusbar.detail);
    } else if (task.commandLine) {
      descriptionParts.push(task.commandLine);
    }
    if (task.hidden) {
      descriptionParts.push('(hidden from status bar)');
    }
    this.description = descriptionParts.join(' · ');

    const iconId = task.statusbar.icon?.id ?? task.config.icon?.id;
    if (running) {
      this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.green'));
    } else if (iconId) {
      const iconColor = task.statusbar.icon?.color ?? task.config.icon?.color;
      this.iconPath = new vscode.ThemeIcon(iconId, iconColor ? new vscode.ThemeColor(iconColor) : undefined);
    } else if (task.isBackground) {
      this.iconPath = new vscode.ThemeIcon('eye');
    } else if (!task.executable) {
      this.iconPath = new vscode.ThemeIcon('list-tree');
    } else {
      this.iconPath = new vscode.ThemeIcon('tools');
    }

    const tooltip = new vscode.MarkdownString(
      [
        `**${task.label}** · \`${task.project.relativePath || task.project.name}\``,
        task.statusbar.detail ?? '',
        task.commandLine ? `\`${task.commandLine.replace(/`/g, "'")}\`` : '',
        task.dependsOn.length
          ? `Depends on (${task.dependsOrder}${task.splitGroup ? ', split terminal' : ''}): ${task.dependsOn.join(', ')}`
          : '',
        running ? '$(sync~spin) Running' : '$(play) Use the play button to run',
      ]
        .filter(Boolean)
        .join('\n\n')
    );
    tooltip.supportThemeIcons = true;
    this.tooltip = tooltip;
  }
}

export type TaskTreeNode = ProjectItem | TaskItem;

export type TreeScopeMode = 'all' | 'active';

export interface TreeState {
  allProjects: readonly ProjectTasks[];
  scope: TaskScope;
  runningIds: Set<string>;
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TaskTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private state: TreeState | undefined;
  private projectItems = new Map<string, ProjectItem>();
  private mode: TreeScopeMode;

  constructor(initialMode: TreeScopeMode) {
    this.mode = initialMode;
  }

  get scopeMode(): TreeScopeMode {
    return this.mode;
  }

  setScopeMode(mode: TreeScopeMode): void {
    this.mode = mode;
    this.changeEmitter.fire(undefined);
  }

  update(state: TreeState): void {
    this.state = state;
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TaskTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TaskTreeNode): TaskTreeNode[] {
    const state = this.state;
    if (!state) {
      return [];
    }
    if (!element) {
      const projects = this.mode === 'active' ? state.scope.projects : state.allProjects;
      const activeId = state.scope.activeProject?.project.id;
      this.projectItems = new Map();
      return projects.map((entry) => {
        const runningCount = entry.tasks.filter((task) => state.runningIds.has(task.id)).length;
        const item = new ProjectItem(entry, entry.project.id === activeId, runningCount);
        this.projectItems.set(entry.project.id, item);
        return item;
      });
    }
    if (element instanceof ProjectItem) {
      return element.entry.tasks.map((task) => new TaskItem(task, state.runningIds.has(task.id)));
    }
    return [];
  }

  getParent(element: TaskTreeNode): TaskTreeNode | undefined {
    if (element instanceof TaskItem) {
      return this.projectItems.get(element.task.project.id);
    }
    return undefined;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
