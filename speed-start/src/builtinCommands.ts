import * as vscode from 'vscode';
import { buildStartupPerformanceReport, type PerfMark } from './startupPerformance';
import { classifyExtension, compareStartupExtensions, type StartupExtensionInfo } from './startupExtensions';

interface BuiltInTool {
  label: string;
  paletteName: string;
  ids: string[];
}

const TOOLS: Record<string, BuiltInTool> = {
  processExplorer: {
    label: 'Process Explorer',
    paletteName: 'Developer: Open Process Explorer',
    ids: ['workbench.action.openProcessExplorer'],
  },
  runningExtensions: {
    label: 'Running Extensions',
    paletteName: 'Developer: Show Running Extensions',
    ids: ['workbench.action.showRuntimeExtensions'],
  },
  extensionBisect: {
    label: 'Extension Bisect',
    paletteName: 'Help: Start Extension Bisect',
    ids: ['extension.bisect.start', 'workbench.extensions.action.extensionBisect.start', 'workbench.action.extension.bisect.start'],
  },
};

export async function showStartupPerformance(): Promise<void> {
  try {
    const content = buildStartupPerformanceReport({
      appName: vscode.env.appName,
      version: vscode.version,
      appHost: vscode.env.appHost,
      remoteName: vscode.env.remoteName,
      ...hostMemory(),
      marks: readHostMarks(),
      startupExtensions: startupExtensions(),
      names: extensionNames(),
    });
    const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Speed Start could not open startup performance. ${message}`);
  }
}

export function showProcessExplorer(): Promise<void> {
  return runBuiltInTool(TOOLS.processExplorer);
}

export function showRunningExtensions(): Promise<void> {
  return runBuiltInTool(TOOLS.runningExtensions);
}

export function startExtensionBisect(): Promise<void> {
  return runBuiltInTool(TOOLS.extensionBisect);
}

export async function openExtension(id: string): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes('workbench.extensions.action.showExtensionsWithIds')) {
    await vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', [id]);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(`vscode:extension/${id}`));
}

async function runBuiltInTool(tool: BuiltInTool): Promise<void> {
  const commands = new Set(await vscode.commands.getCommands(true));
  for (const id of tool.ids) {
    if (commands.has(id)) {
      await vscode.commands.executeCommand(id);
      return;
    }
  }
  void vscode.window.showInformationMessage(
    `Cursor does not expose ${tool.label} in this build. Open the Command Palette and run "${tool.paletteName}".`,
  );
}

function hostMemory(): { uptimeMs?: number; heapUsed?: number; rss?: number } {
  if (typeof process === 'undefined' || typeof process.uptime !== 'function' || typeof process.memoryUsage !== 'function') {
    return {};
  }
  const memory = process.memoryUsage();
  return {
    uptimeMs: process.uptime() * 1000,
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

function readHostMarks(): PerfMark[] {
  const host = globalThis as { MonacoPerformanceMarks?: { getMarks?: () => unknown } };
  const stored = normalizeMarks(host.MonacoPerformanceMarks?.getMarks?.());
  if (stored.length > 0) {
    return stored;
  }
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return [];
  }
  return normalizeMarks(performance.getEntriesByType('mark'));
}

function normalizeMarks(raw: unknown): PerfMark[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const marks: PerfMark[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as { name?: unknown; startTime?: unknown };
    if (typeof record.name !== 'string' || typeof record.startTime !== 'number' || !Number.isFinite(record.startTime)) {
      continue;
    }
    marks.push({ name: record.name, startTime: record.startTime });
  }
  return marks;
}

function extensionNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const extension of vscode.extensions.all) {
    names[extension.id] = displayName(extension);
  }
  return names;
}

function startupExtensions(): StartupExtensionInfo[] {
  const found: StartupExtensionInfo[] = [];
  for (const extension of vscode.extensions.all) {
    const info = classifyExtension(extension.id, displayName(extension), extension.isActive, activationEvents(extension));
    if (info) {
      found.push(info);
    }
  }
  found.sort(compareStartupExtensions);
  return found;
}

function activationEvents(extension: vscode.Extension<unknown>): string[] {
  const events = extension.packageJSON?.activationEvents;
  if (!Array.isArray(events)) {
    return [];
  }
  return events.filter((event): event is string => typeof event === 'string');
}

function displayName(extension: vscode.Extension<unknown>): string {
  const name = extension.packageJSON?.displayName;
  return typeof name === 'string' && name.trim() ? name : extension.id;
}
