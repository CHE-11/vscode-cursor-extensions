import * as vscode from 'vscode';

interface BuiltInTool {
  label: string;
  paletteName: string;
  ids: string[];
}

const TOOLS: Record<string, BuiltInTool> = {
  startupPerformance: {
    label: 'Startup Performance',
    paletteName: 'Developer: Startup Performance',
    ids: ['perfview.show'],
  },
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

export function showStartupPerformance(): Promise<void> {
  return runBuiltInTool(TOOLS.startupPerformance);
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
