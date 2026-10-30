import type * as vscode from 'vscode';

export type ScopeMode = 'activeFile' | 'all';

export type DependsOrder = 'parallel' | 'sequence';

export interface IconConfig {
  id?: string | null;
  color?: string;
}

export interface StatusBarAppearance {
  label?: string;
  icon?: IconConfig;
  color?: string;
  backgroundColor?: string;
}

export interface StatusBarOptions extends StatusBarAppearance {
  hide?: boolean;
  detail?: string;
  filePattern?: string;
  running?: StatusBarAppearance;
}

export interface TaskOptionsConfig {
  cwd?: string;
  env?: Record<string, string>;
  shell?: {
    executable?: string;
    args?: string[];
  };
  statusbar?: StatusBarOptions;
  /**
   * On a `dependsOn` task: run every dependency side by side in one split terminal.
   * `true` uses a group named after this task; a string sets the group name explicitly.
   */
  split?: boolean | string;
}

export type ArgConfig = string | { value: string; quoting?: 'escape' | 'strong' | 'weak' };

export type CommandConfig = string | ArgConfig | ArgConfig[];

export interface PresentationConfig {
  reveal?: 'always' | 'silent' | 'never';
  echo?: boolean;
  focus?: boolean;
  panel?: 'shared' | 'dedicated' | 'new';
  showReuseMessage?: boolean;
  clear?: boolean;
  group?: string;
  close?: boolean;
}

export type GroupConfig =
  | string
  | {
      kind: string;
      isDefault?: boolean | string;
    };

export type DependsOnConfig = string | { label?: string; task?: string; type?: string } | Array<string | { label?: string; task?: string; type?: string }>;

export interface TaskConfigBase {
  type?: string;
  command?: CommandConfig;
  args?: ArgConfig[];
  options?: TaskOptionsConfig;
  problemMatcher?: string | object | Array<string | object>;
  isBackground?: boolean;
  presentation?: PresentationConfig;
  group?: GroupConfig;
  detail?: string;
  icon?: IconConfig;
  hide?: boolean;
  script?: string;
  path?: string;
  dependsOn?: DependsOnConfig;
  dependsOrder?: DependsOrder;
}

export interface TaskConfig extends TaskConfigBase {
  label?: string;
  windows?: TaskConfigBase;
  osx?: TaskConfigBase;
  linux?: TaskConfigBase;
}

export interface TasksFileConfig extends TaskConfigBase {
  version?: string;
  tasks?: TaskConfig[];
  windows?: TaskConfigBase;
  osx?: TaskConfigBase;
  linux?: TaskConfigBase;
}

export interface ProjectInfo {
  /** Stable id: the project folder's fsPath, lower-cased on Windows. */
  id: string;
  name: string;
  folderUri: vscode.Uri;
  tasksFileUri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  /** Path relative to the owning workspace folder; empty for the workspace folder itself. */
  relativePath: string;
}

export interface ManagedTask {
  /** Unique id: `${project.id}::${label}` (with an index suffix if labels repeat). */
  id: string;
  label: string;
  project: ProjectInfo;
  /** Merged config (global + platform + task + task platform). */
  config: TaskConfig;
  /** Zero-based position in the tasks array, used to jump to the definition. */
  index: number;
  /** False for pure `dependsOn` compound tasks that have no command of their own. */
  executable: boolean;
  isBackground: boolean;
  dependsOn: string[];
  dependsOrder: DependsOrder;
  /** Terminal group passed down to dependencies when `options.split` is set. */
  splitGroup?: string;
  statusbar: StatusBarOptions;
  hidden: boolean;
  commandLine: string;
}

export interface ProjectTasks {
  project: ProjectInfo;
  tasks: ManagedTask[];
  error?: string;
}
