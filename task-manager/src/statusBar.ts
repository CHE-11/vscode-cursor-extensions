import * as vscode from 'vscode';
import { log } from './logger';
import type { TaskScope } from './scope';
import type { IconConfig, ManagedTask, ProjectInfo, StatusBarAppearance } from '../types/tasks';

/**
 * Left items are ordered by descending priority.
 * The error, warning, and info counts are one item at priority 50.
 * Show Running Tasks is pinned to that item's right, so the first free
 * slot on the right of Info is 49. Every task shares one priority so a
 * long list stays together.
 */
const SCOPE_PRIORITY = 49;
const TASK_PRIORITY = 48;

export const RUN_TASK_COMMAND = 'taskManager.runTask';
export const SELECT_TASK_COMMAND = 'taskManager.selectTask';
export const FOCUS_VIEW_COMMAND = 'taskManager.tasks.focus';
export const OPEN_TASKS_FILE_COMMAND = 'taskManager.openTasksFile';

export interface TaskPickItem extends vscode.QuickPickItem {
  taskId?: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface RenderedItem {
  text: string;
  tooltip: vscode.MarkdownString | string | undefined;
  color: string | vscode.ThemeColor | undefined;
  backgroundColor: vscode.ThemeColor | undefined;
  command: vscode.Command | string;
  name: string;
  /** Ease the label between a dim and bright color while this task is running. */
  pulse?: boolean;
  /** Hex color to pulse around. Unset uses the status bar foreground. */
  pulseRgb?: Rgb;
}

const PULSE_INTERVAL_MS = 50;
const PULSE_PERIOD_MS = 1400;

function parseHex(color: string | undefined): Rgb | undefined {
  if (!color) {
    return undefined;
  }
  const match = /^#([\da-f]{3,8})$/i.exec(color.trim());
  if (!match) {
    return undefined;
  }
  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .slice(0, 3)
      .split('')
      .map((channel) => channel + channel)
      .join('');
  }
  if (hex.length < 6) {
    return undefined;
  }
  const value = Number.parseInt(hex.slice(0, 6), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function formatChannel(channel: number): string {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, '0');
}

function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

/** 0 is the dim end of the pulse, 1 is the bright end. */
function pulseAmount(elapsed: number): number {
  const phase = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

function mixChannel(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function pulseEnds(base: Rgb | undefined, light: boolean): [Rgb, Rgb] {
  if (!base) {
    return light
      ? [
          { r: 168, g: 168, b: 168 },
          { r: 28, g: 28, b: 28 },
        ]
      : [
          { r: 92, g: 92, b: 92 },
          { r: 255, g: 255, b: 255 },
        ];
  }
  const dim = light ? 0.72 : 0.35;
  const bright = light ? 0.15 : 0.62;
  return [
    {
      r: mixChannel(base.r, light ? 255 : 0, dim),
      g: mixChannel(base.g, light ? 255 : 0, dim),
      b: mixChannel(base.b, light ? 255 : 0, dim),
    },
    {
      r: mixChannel(base.r, light ? 0 : 255, bright),
      g: mixChannel(base.g, light ? 0 : 255, bright),
      b: mixChannel(base.b, light ? 0 : 255, bright),
    },
  ];
}

function colorAt(base: Rgb | undefined, amount: number, light: boolean): string {
  const [dim, bright] = pulseEnds(base, light);
  return `#${formatChannel(mixChannel(dim.r, bright.r, amount))}${formatChannel(mixChannel(dim.g, bright.g, amount))}${formatChannel(mixChannel(dim.b, bright.b, amount))}`;
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

function formatText(label: string, icon: IconConfig | undefined, _running: boolean, _hasRunningIcon: boolean): string {
  // if (running && !hasRunningIcon) {
  //   return `$(sync~spin) ${label}`;
  // }
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
  private rendered: RenderedItem[] = [];
  private scopeItem: vscode.StatusBarItem | undefined;
  private overflow: TaskPickItem[] = [];
  private pulseTimer: ReturnType<typeof setInterval> | undefined;
  private pulseStartedAt = 0;

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
        const pulseRgb = parseHex(appearance.color);
        items.push({
          text: formatText(appearance.label, appearance.icon, running, Boolean(managed.statusbar.running?.icon)),
          tooltip: createTooltip(managed, running, showProjectName),
          color: convertColor(appearance.color),
          backgroundColor: appearance.backgroundColor ? new vscode.ThemeColor(appearance.backgroundColor) : undefined,
          command: { title: 'Run Task', command: RUN_TASK_COMMAND, arguments: [managed.id] },
          name: `Task: ${managed.label}`,
          pulse: running && (appearance.color === undefined || pulseRgb !== undefined),
          pulseRgb,
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
      this.scopeItem = vscode.window.createStatusBarItem('taskManager.scope', vscode.StatusBarAlignment.Left, SCOPE_PRIORITY);
      this.scopeItem.name = 'Task Manager: Scope';
      this.scopeItem.command = FOCUS_VIEW_COMMAND;
    }
    if (scope.activeProject) {
      const project = scope.activeProject.project;
      this.scopeItem.text = `$(folder-opened) ${project.name}`;
      this.scopeItem.tooltip = `Showing tasks from ${project.relativePath}/.vscode/tasks.json. Click to open the Task Manager panel.`;
    } 
    this.scopeItem.show();
  }

  private sync(rendered: RenderedItem[]): void {
    while (this.items.length < rendered.length) {
      const index = this.items.length;
      const item = vscode.window.createStatusBarItem(`taskManager.task.${index}`, vscode.StatusBarAlignment.Left, TASK_PRIORITY);
      this.items.push(item);
    }
    while (this.items.length > rendered.length) {
      this.items.pop()?.dispose();
    }
    this.rendered = rendered;
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
    this.syncPulseTimer();
    if (this.pulseTimer) {
      this.applyPulse();
    }
  }

  private syncPulseTimer(): void {
    const pulsing = this.rendered.some((item) => item.pulse);
    if (!pulsing) {
      this.stopPulse();
      return;
    }
    if (this.pulseTimer) {
      return;
    }
    this.pulseStartedAt = Date.now();
    this.pulseTimer = setInterval(() => this.applyPulse(), PULSE_INTERVAL_MS);
  }

  private applyPulse(): void {
    const amount = pulseAmount(Date.now() - this.pulseStartedAt);
    const light = isLightTheme();
    this.rendered.forEach((source, index) => {
      if (!source.pulse) {
        return;
      }
      const item = this.items[index];
      if (item) {
        item.color = colorAt(source.pulseRgb, amount, light);
      }
    });
  }

  private stopPulse(): void {
    if (!this.pulseTimer) {
      return;
    }
    clearInterval(this.pulseTimer);
    this.pulseTimer = undefined;
  }

  dispose(): void {
    this.stopPulse();
    this.rendered = [];
    this.items.forEach((item) => item.dispose());
    this.items = [];
    this.scopeItem?.dispose();
    this.scopeItem = undefined;
  }
}
