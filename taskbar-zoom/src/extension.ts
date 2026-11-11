import * as vscode from 'vscode';
import {
  levelToPercent,
  nextZoomLevel,
  normalizePresets,
  parseDisplayOrder,
  percentToDisplayString,
  percentToLevel,
  roundZoom,
  zoomInputError,
  type ZoomDirection,
  type ZoomUnitType,
} from './zoom';

const PREVIEW_DELAY_MS = 500;
// One priority for every control. Distinct priorities leave gaps that other status bar items sort into.
const STATUS_BAR_PRIORITY = 100;
const DEFAULT_PRESETS = [300, 250, 200, 175, 150, 140, 130, 120, 110, 105, 100, 95, 90, 80, 75, 70, 60, 50];

const messages = {
  selectPlaceholder: 'Select a zoom',
  inputPlaceholder: 'Input a zoom',
  resetZoom: 'Reset zoom',
  inputZoom: 'Input zoom',
  current: '( current )',
  mustBeNumber: 'Must be a number.',
  range: 'Range',
  noPreview: 'No preview',
  selectZoom: 'Select Zoom',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  fontZoomReset: 'Editor Font Zoom Reset',
} as const;

interface ZoomSnapshot {
  globalValue?: number;
  workspaceValue?: number;
}

type ZoomChoice = vscode.QuickPickItem & ({ action: 'level'; level: number } | { action: 'command'; run: () => Promise<void> });

const items = new Map<string, vscode.StatusBarItem>();
let shownOrder = '';
let shownLevel: number | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let writeGeneration = 0;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('taskbar-zoom.selectZoom', selectZoom),
    vscode.commands.registerCommand('taskbar-zoom.resetZoom', () => writeLevel(percentToLevel(defaultZoom()))),
    vscode.commands.registerCommand('taskbar-zoom.zoomIn', () => step('in')),
    vscode.commands.registerCommand('taskbar-zoom.zoomOut', () => step('out')),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('taskbarZoom') || event.affectsConfiguration('window.zoomLevel')) {
        updateStatusBar();
      }
    }),
    new vscode.Disposable(() => {
      clearPreview();
      disposeItems();
    }),
  );
  updateStatusBar();
}

export function deactivate(): void {}

function text(key: keyof typeof messages): string {
  return messages[key];
}

async function step(direction: ZoomDirection): Promise<void> {
  const next = nextZoomLevel(readLevel(), zoomUnit(), direction, zoomUnitType());
  if (next === undefined) {
    return;
  }
  await writeLevel(next);
}

async function selectZoom(): Promise<void> {
  const snapshot = readSnapshot();
  const preview = booleanSetting('taskbarZoom.preview', true);
  const current = roundZoom(levelToPercent(readLevel()));
  const picker = vscode.window.createQuickPick<ZoomChoice>();
  picker.placeholder = text('selectPlaceholder');
  picker.items = zoomChoices(current);
  let accepted = false;

  picker.onDidChangeActive((active) => {
    const choice = active[0];
    if (preview && choice?.action === 'level') {
      previewLevel(choice.level);
    }
  });
  picker.onDidAccept(() => {
    accepted = true;
    const choice = picker.selectedItems[0];
    picker.hide();
    void acceptChoice(choice, snapshot);
  });
  picker.onDidHide(() => {
    if (!accepted) {
      void restoreSnapshot(snapshot);
    }
    picker.dispose();
  });
  picker.show();
}

async function acceptChoice(choice: ZoomChoice | undefined, snapshot: ZoomSnapshot): Promise<void> {
  if (!choice || choice.action === 'command') {
    await restoreSnapshot(snapshot);
    if (choice?.action === 'command') {
      await choice.run();
    }
    return;
  }
  await writeLevel(choice.level);
}

function zoomChoices(current: number): ZoomChoice[] {
  const resetPercent = defaultZoom();
  const choices: ZoomChoice[] = [
    {
      action: 'level',
      level: percentToLevel(resetPercent),
      label: `$(home) ${text('resetZoom')} ( ${percentToDisplayString(resetPercent)} )`,
    },
    {
      action: 'command',
      label: `${stringSetting('taskbarZoom.fontZoomResetLabel', '$(text-size)')} ${text('fontZoomReset')}`,
      description: text('noPreview'),
      run: async () => {
        await vscode.commands.executeCommand('editor.action.fontZoomReset');
      },
    },
    {
      action: 'command',
      label: `$(pencil) ${text('inputZoom')}`,
      run: () => inputZoom(readSnapshot(), current),
    },
  ];
  for (const preset of presets()) {
    choices.push({
      action: 'level',
      level: percentToLevel(preset),
      label: `$(text-size) ${percentToDisplayString(preset)}`,
      description: current === roundZoom(preset) ? text('current') : '',
    });
  }
  return choices;
}

async function inputZoom(snapshot: ZoomSnapshot, current: number): Promise<void> {
  const preview = booleanSetting('taskbarZoom.preview', true);
  const box = vscode.window.createInputBox();
  box.placeholder = text('inputPlaceholder');
  box.value = String(current);
  let accepted = false;

  const showError = (raw: string): string | undefined => zoomInputError(raw, text('mustBeNumber'), text('range'));
  box.onDidChangeValue((value) => {
    const error = showError(value);
    box.validationMessage = error ?? '';
    if (preview && !error) {
      previewLevel(percentToLevel(Number(value.trim())));
    }
  });
  box.onDidAccept(() => {
    const error = showError(box.value);
    box.validationMessage = error ?? '';
    if (error) {
      return;
    }
    accepted = true;
    const level = percentToLevel(Number(box.value.trim()));
    box.hide();
    void writeLevel(level);
  });
  box.onDidHide(() => {
    if (!accepted) {
      void restoreSnapshot(snapshot);
    }
    box.dispose();
  });
  box.show();
}

function updateStatusBar(): void {
  const order = parseDisplayOrder(stringSetting('taskbarZoom.uiDisplayOrder', '@-%+'));
  const orderKey = order.join('');
  if (orderKey !== shownOrder) {
    disposeItems();
    // Create left to right. Equal priority keeps that creation order, so the block stays in uiDisplayOrder.
    for (const token of order) {
      const item = vscode.window.createStatusBarItem(itemId(token), vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
      item.show();
      items.set(token, item);
    }
    shownOrder = orderKey;
  }
  for (const [token, item] of items) {
    item.text = labelFor(token);
    item.tooltip = tooltipFor(token);
    item.command = commandFor(token);
  }
}

function itemId(token: string): string {
  switch (token) {
    case '+':
      return 'taskbarZoom.zoomIn';
    case '-':
      return 'taskbarZoom.zoomOut';
    case '@':
      return 'taskbarZoom.fontReset';
    default:
      return 'taskbarZoom.percent';
  }
}

function commandFor(token: string): string {
  switch (token) {
    case '+':
      return 'taskbar-zoom.zoomIn';
    case '-':
      return 'taskbar-zoom.zoomOut';
    case '@':
      return 'editor.action.fontZoomReset';
    default:
      return 'taskbar-zoom.selectZoom';
  }
}

function tooltipFor(token: string): string {
  switch (token) {
    case '+':
      return text('zoomIn');
    case '-':
      return text('zoomOut');
    case '@':
      return text('fontZoomReset');
    default:
      return text('selectZoom');
  }
}

function labelFor(token: string): string {
  switch (token) {
    case '+':
      return stringSetting('taskbarZoom.zoomInLabel', '+');
    case '-':
      return stringSetting('taskbarZoom.zoomOutLabel', '-');
    case '@':
      return stringSetting('taskbarZoom.fontZoomResetLabel', '$(text-size)');
    default:
      return percentToDisplayString(levelToPercent(readLevel()));
  }
}

function previewLevel(level: number): void {
  const generation = ++writeGeneration;
  shownLevel = level;
  updateStatusBar();
  if (previewTimer) {
    clearTimeout(previewTimer);
  }
  previewTimer = setTimeout(() => {
    previewTimer = undefined;
    void commitLevel(level, generation);
  }, PREVIEW_DELAY_MS);
}

async function writeLevel(level: number): Promise<void> {
  const generation = ++writeGeneration;
  clearPreview();
  shownLevel = level;
  updateStatusBar();
  await commitLevel(level, generation);
}

async function commitLevel(level: number, generation: number): Promise<void> {
  try {
    const target = await resolveTarget();
    if (generation !== writeGeneration) {
      return;
    }
    await vscode.workspace.getConfiguration().update('window.zoomLevel', level, target);
    if (generation !== writeGeneration) {
      return;
    }
    shownLevel = undefined;
    updateStatusBar();
  } catch (error) {
    if (generation === writeGeneration) {
      shownLevel = undefined;
      updateStatusBar();
    }
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Taskbar Zoom could not change the zoom. ${message}`);
  }
}

async function restoreSnapshot(snapshot: ZoomSnapshot): Promise<void> {
  writeGeneration += 1;
  clearPreview();
  shownLevel = undefined;
  const config = vscode.workspace.getConfiguration();
  await config.update('window.zoomLevel', snapshot.globalValue, vscode.ConfigurationTarget.Global);
  await config.update('window.zoomLevel', snapshot.workspaceValue, vscode.ConfigurationTarget.Workspace);
  updateStatusBar();
}

async function resolveTarget(): Promise<vscode.ConfigurationTarget> {
  const mode = stringSetting('taskbarZoom.configurationTarget', 'auto');
  const snapshot = readSnapshot();
  const hasWorkspace = snapshot.workspaceValue !== undefined;
  if (mode === 'global') {
    if (hasWorkspace) {
      await vscode.workspace.getConfiguration().update('window.zoomLevel', undefined, vscode.ConfigurationTarget.Workspace);
    }
    return vscode.ConfigurationTarget.Global;
  }
  if (mode === 'workspace' && (vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
    return vscode.ConfigurationTarget.Workspace;
  }
  if (mode === 'auto' && hasWorkspace) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

function readLevel(): number {
  if (shownLevel !== undefined) {
    return shownLevel;
  }
  return numberSetting('window.zoomLevel', 0);
}

function readSnapshot(): ZoomSnapshot {
  const inspected = vscode.workspace.getConfiguration().inspect<number>('window.zoomLevel');
  return {
    globalValue: inspected?.globalValue,
    workspaceValue: inspected?.workspaceValue,
  };
}

function defaultZoom(): number {
  return numberSetting('taskbarZoom.defaultZoom', 100);
}

function zoomUnit(): number {
  return numberSetting('taskbarZoom.zoomUnit', 10);
}

function zoomUnitType(): ZoomUnitType {
  return stringSetting('taskbarZoom.zoomUnitType', 'multiplicative') === 'additive' ? 'additive' : 'multiplicative';
}

function presets(): number[] {
  const value = vscode.workspace.getConfiguration().get<number[]>('taskbarZoom.zoomPreset');
  return normalizePresets(Array.isArray(value) ? value : DEFAULT_PRESETS);
}

function numberSetting(key: string, fallback: number): number {
  const value = vscode.workspace.getConfiguration().get<number>(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringSetting(key: string, fallback: string): string {
  const value = vscode.workspace.getConfiguration().get<string>(key);
  return typeof value === 'string' ? value : fallback;
}

function booleanSetting(key: string, fallback: boolean): boolean {
  const value = vscode.workspace.getConfiguration().get<boolean>(key);
  return typeof value === 'boolean' ? value : fallback;
}

function clearPreview(): void {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = undefined;
  }
}

function disposeItems(): void {
  for (const item of items.values()) {
    item.dispose();
  }
  items.clear();
  shownOrder = '';
}
