import * as vscode from 'vscode';
import { log } from './logger';
import type { TaskScope } from './scope';
import type { IconConfig, ManagedTask, ProjectInfo, StatusBarAppearance } from '../types/tasks';

/** Left items are ordered by descending priority; a negative value places tasks after the built-in items. */
const BASE_PRIORITY = -1000;

export const RUN_TASK_COMMAND = 'taskManager.runTask';
export const SELECT_TASK_COMMAND = 'taskManager.selectTask';
export const FOCUS_VIEW_COMMAND = 'taskManager.tasks.focus';
export const OPEN_TASKS_FILE_COMMAND = 'taskManager.openTasksFile';

export interface TaskPickItem extends vscode.QuickPickItem {
  taskId?: string;
}

interface RenderedItem {
  text: string;
  tooltip: vscode.MarkdownString | string | undefined;
  color: string | vscode.ThemeColor | undefined;
  backgroundColor: vscode.ThemeColor | undefined;
  command: vscode.Command | string;
  name: string;
}

function convertColor(color: string | undefined): string | vscode.ThemeColor | undefined {
  if (typeof color !== 'string' || color === '') {
    return undefined;
  }
  return color.startsWith('#') ? color : new vscode.ThemeColor(color);
}

function matchesFilePattern(managed: ManagedTask, activeFile: string | undefined): boolean {
  const pattern = managed.statusbar.filePattern;
  if (!pattern) {
    return true;
  }
  try {
    return activeFile !== undefined && new RegExp(pattern).test(activeFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Invalid filePattern "${pattern}" on task "${managed.label}": ${message}`);
    return false;
  }
}

function pickAppearance(managed: ManagedTask, running: boolean): Required<Pick<StatusBarAppearance, 'label'>> & StatusBarAppearance {
  const base = managed.statusbar;
  const runningOverrides: StatusBarAppearance = running ? base.running ?? {} : {};
  const defaults = vscode.workspace.getConfiguration('taskManager.statusbar.default');
  return {
    label: runningOverrides.label ?? base.label ?? managed.label,
    icon: runningOverrides.icon ?? base.icon,
    color: runningOverrides.color ?? base.color ?? (defaults.get<string>('color') || undefined),
    backgroundColor: runningOverrides.backgroundColor ?? base.backgroundColor,
  };
}

function formatText(label: string, icon: IconConfig | undefined, running: boolean, hasRunningIcon: boolean): string {
  if (running && !hasRunningIcon) {
    return `$(sync~spin) ${label}`;
  }
  return icon?.id ? `$(${icon.id}) ${label}` : label;
}

function createTooltip(managed: ManagedTask, running: boolean, showProjectName: boolean): vscode.MarkdownString {
  const lines: string[] = [];
  const projectName = managed.project.relativePath || managed.project.name;
  lines.push(showProjectName ? `**${managed.label}** · \`${projectName}\`` : `**${managed.label}**`);
  if (managed.statusbar.detail) {
    lines.push(managed.statusbar.detail);
  }
  if (managed.commandLine) {
    lines.push(`\`${managed.commandLine.replace(/`/g, "'")}\``);
  }
  lines.push(running ? '$(sync~spin) Running' : '$(play) Click to run');
  const markdown = new vscode.MarkdownString(lines.join('\n\n'));
  markdown.isTrusted = true;
  markdown.supportThemeIcons = true;
  return markdown;
}

const MAX_GROUP_LABEL_LENGTH = 14;

function shortenName(name: string): string {
  return name.length > MAX_GROUP_LABEL_LENGTH ? `${name.slice(0, MAX_GROUP_LABEL_LENGTH - 1)}…` : name;
}

function createGroupLabel(project: ProjectInfo): RenderedItem {
  return {
    text: `│ ${shortenName(project.name)}`,
    tooltip: `Tasks from ${project.relativePath || project.name}/.vscode/tasks.json. Click to open it.`,
    color: new vscode.ThemeColor('descriptionForeground'),
    backgroundColor: undefined,
    command: { title: 'Open tasks.json', command: OPEN_TASKS_FILE_COMMAND, arguments: [project.id] },
    name: `Task Manager: ${project.name}`,
  };
}

export class StatusBarManager implements vscode.Disposable {
  private items: vscode.StatusBarItem[] = [];
  private scopeItem: vscode.StatusBarItem | undefined;
  private overflow: TaskPickItem[] = [];

  get overflowItems(): readonly TaskPickItem[] {
    return this.overflow;
  }

  render(scope: TaskScope, runningIds: Set<string>, activeFile: vscode.Uri | undefined): void {
    const config = vscode.workspace.getConfiguration('taskManager.statusbar');
    const limit = config.get<number | null>('limit');
    const showProjectName = config.get<boolean>('showProjectName') ?? true;
    const activeFilePath = activeFile?.fsPath;

    const groups: { entry: TaskScope['projects'][number]; items: RenderedItem[] }[] = [];
    let taskCount = 0;
    this.overflow = [];

    for (const entry of scope.projects) {
      const items: RenderedItem[] = [];
      groups.push({ entry, items });
      for (const managed of entry.tasks) {
        if (managed.hidden || !matchesFilePattern(managed, activeFilePath)) {
          continue;
        }
        const running = runningIds.has(managed.id);
        if (typeof limit === 'number' && taskCount >= limit) {
          this.overflow.push({
            label: managed.label,
            description: entry.project.relativePath || entry.project.name,
            detail: managed.statusbar.detail ?? managed.commandLine,
            taskId: managed.id,
          });
          continue;
        }
        const appearance = pickAppearance(managed, running);
        taskCount++;
        items.push({
          text: formatText(appearance.label, appearance.icon, running, Boolean(managed.statusbar.running?.icon)),
          tooltip: createTooltip(managed, running, showProjectName),
          color: convertColor(appearance.color),
          backgroundColor: appearance.backgroundColor ? new vscode.ThemeColor(appearance.backgroundColor) : undefined,
          command: { title: 'Run Task', command: RUN_TASK_COMMAND, arguments: [managed.id] },
          name: `Task: ${managed.label}`,
        });
      }
    }

    const visibleGroups = groups.filter((group) => group.items.length > 0);
    const showGroupLabels = (config.get<boolean>('groupLabels') ?? true) && visibleGroups.length > 1;
    const rendered: RenderedItem[] = [];
    for (const group of visibleGroups) {
      if (showGroupLabels) {
        rendered.push(createGroupLabel(group.entry.project));
      }
      rendered.push(...group.items);
    }

    if (this.overflow.length > 0) {
      const select = vscode.workspace.getConfiguration('taskManager.statusbar.select');
      rendered.push({
        text: select.get<string>('label') || '...',
        tooltip: `${this.overflow.length} more task(s)`,
        color: convertColor(select.get<string>('color')),
        backgroundColor: undefined,
        command: { title: 'Select Task', command: SELECT_TASK_COMMAND, arguments: ['overflow'] },
        name: 'Task Manager: More Tasks',
      });
    }

    this.renderScopeItem(scope, rendered.length > 0);
    this.sync(rendered);
  }

  private renderScopeItem(scope: TaskScope, hasTasks: boolean): void {
    const showScope = vscode.workspace.getConfiguration('taskManager.statusbar').get<boolean>('showScope') ?? true;
    if (!showScope || !hasTasks || scope.projects.length === 0) {
      this.scopeItem?.hide();
      return;
    }
    if (!this.scopeItem) {
      this.scopeItem = vscode.window.createStatusBarItem('taskManager.scope', vscode.StatusBarAlignment.Left, BASE_PRIORITY + 1);
      this.scopeItem.name = 'Task Manager: Scope';
      this.scopeItem.command = FOCUS_VIEW_COMMAND;
    }
    if (scope.activeProject) {
      const project = scope.activeProject.project;
      this.scopeItem.text = `$(folder-opened) ${project.name}`;
      this.scopeItem.tooltip = `Showing tasks from ${project.relativePath}/.vscode/tasks.json. Click to open the Task Manager panel.`;
    } else {
      this.scopeItem.text = '$(folder-library) All';
      this.scopeItem.tooltip = `Showing tasks from ${scope.projects.length} project(s). Click to open the Task Manager panel.`;
    }
    this.scopeItem.show();
  }

  private sync(rendered: RenderedItem[]): void {
    while (this.items.length < rendered.length) {
      const index = this.items.length;
      const item = vscode.window.createStatusBarItem(`taskManager.task.${index}`, vscode.StatusBarAlignment.Left, BASE_PRIORITY - index);
      this.items.push(item);
    }
    while (this.items.length > rendered.length) {
      this.items.pop()?.dispose();
    }
    rendered.forEach((source, index) => {
      const item = this.items[index];
      item.name = source.name;
      item.text = source.text;
      item.tooltip = source.tooltip;
      item.color = source.color;
      item.backgroundColor = source.backgroundColor;
      item.command = source.command;
      item.show();
    });
  }

  dispose(): void {
    this.items.forEach((item) => item.dispose());
    this.items = [];
    this.scopeItem?.dispose();
    this.scopeItem = undefined;
  }
}
