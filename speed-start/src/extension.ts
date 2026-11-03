import * as vscode from 'vscode';
import { openExtension, showProcessExplorer, showRunningExtensions, showStartupPerformance, startExtensionBisect } from './builtinCommands';
import { ExtensionAuditProvider } from './extensionAudit';
import { HeavyTreeProvider } from './heavyTree';
import { addToIgnore, copyIgnorePattern, excludeFromSearchAndWatcher, revealTarget, selectedPaths } from './ignoreActions';
import { disposeLogger, log } from './logger';
import { buildReport } from './report';
import { scanWorkspace, type ScanResult } from './scan';
import { syncWarning } from './syncRoot';

const ANALYZED_KEY = 'speedStart.analyzed';
const HEAVY_VIEW_ID = 'speedStart.heavyPaths';

export function activate(context: vscode.ExtensionContext): void {
  const heavy = new HeavyTreeProvider();
  const audit = new ExtensionAuditProvider();
  const heavyView = vscode.window.createTreeView(HEAVY_VIEW_ID, {
    treeDataProvider: heavy,
    showCollapseAll: true,
    canSelectMany: true,
  });
  const auditView = vscode.window.createTreeView('speedStart.startupExtensions', {
    treeDataProvider: audit,
    showCollapseAll: true,
  });
  let result: ScanResult | undefined;
  let scanning = false;

  const applyTreeMessage = (): void => {
    if (!result) {
      heavyView.message = undefined;
      return;
    }
    const lines: string[] = [];
    const warning = syncWarning(result.syncMarkers);
    if (warning) {
      lines.push(warning);
    }
    if (result.cancelled) {
      lines.push('Scan cancelled. Results are partial.');
    }
    if (result.capped) {
      lines.push('Scan stopped at the visit limit. Raise speedStart.maxFilesVisited to see more.');
    }
    if (result.listCapped) {
      lines.push(`Showing the ${result.candidates.length} heaviest paths.`);
    }
    if (result.unreadable > 0) {
      lines.push(`${result.unreadable} directories could not be read. See the Speed Start output channel.`);
    }
    heavyView.message = lines.join(' ');
  };

  const analyze = async (): Promise<void> => {
    if (scanning) {
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      void vscode.window.showInformationMessage('Open a folder to analyze startup cost.');
      return;
    }
    scanning = true;
    heavy.setScanning(true);
    await vscode.commands.executeCommand('setContext', ANALYZED_KEY, true);
    try {
      const config = vscode.workspace.getConfiguration('speedStart');
      const multiRoot = folders.length > 1;
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Speed Start',
          cancellable: true,
        },
        (progress, token) => {
          progress.report({ message: 'Counting files…' });
          return scanWorkspace({
            roots: folders.map((folder) => ({ fsPath: folder.uri.fsPath, name: folder.name })),
            directoryFileCount: positive(config.get<number>('directoryFileCount'), 500),
            directoryBytes: Math.max(0, config.get<number>('directorySizeMB', 5)) * 1024 * 1024,
            fileBytes: Math.max(0, config.get<number>('fileSizeMB', 1)) * 1024 * 1024,
            maxEntries: positive(config.get<number>('maxEntries'), 40),
            maxFilesVisited: positive(config.get<number>('maxFilesVisited'), 200000),
            isCancelled: () => token.isCancellationRequested,
            onProgress: (visited) => progress.report({ message: `${visited.toLocaleString('en-US')} entries` }),
            onUnreadable: (absolutePath) => log(`Unreadable directory: ${absolutePath}`),
          });
        },
      );
      heavy.setResult(result, multiRoot);
      audit.refresh();
      applyTreeMessage();
    } catch (error) {
      heavy.setScanning(false);
      if (!result) {
        await vscode.commands.executeCommand('setContext', ANALYZED_KEY, false);
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`Analyze failed: ${message}`);
      void vscode.window.showErrorMessage(`Speed Start could not analyze this workspace. ${message}`);
    } finally {
      scanning = false;
    }
  };

  void vscode.commands.executeCommand('setContext', ANALYZED_KEY, false);
  if (auditView.visible) {
    audit.refresh();
  }

  context.subscriptions.push(
    heavy,
    audit,
    heavyView,
    auditView,
    auditView.onDidChangeVisibility((event) => {
      if (event.visible) {
        audit.refresh();
      }
    }),
    vscode.commands.registerCommand('speedStart.analyze', () => analyze()),
    vscode.commands.registerCommand('speedStart.copyReport', async () => {
      if (!result) {
        void vscode.window.showInformationMessage('Analyze the workspace first.');
        return;
      }
      await vscode.env.clipboard.writeText(buildReport(result, audit.getExtensions()));
      void vscode.window.showInformationMessage('Copied the Speed Start report.');
    }),
    vscode.commands.registerCommand('speedStart.addToCursorIgnore', (arg: unknown) =>
      addToIgnore(selectedPaths(arg, heavyView.selection, false), '.cursorignore'),
    ),
    vscode.commands.registerCommand('speedStart.addToGitIgnore', (arg: unknown) =>
      addToIgnore(selectedPaths(arg, heavyView.selection, false), '.gitignore'),
    ),
    vscode.commands.registerCommand('speedStart.excludeSearchWatcher', (arg: unknown) =>
      excludeFromSearchAndWatcher(selectedPaths(arg, heavyView.selection, false)),
    ),
    vscode.commands.registerCommand('speedStart.copyPattern', (arg: unknown) =>
      copyIgnorePattern(selectedPaths(arg, heavyView.selection, false)),
    ),
    vscode.commands.registerCommand('speedStart.reveal', (arg: unknown) => {
      const [target] = selectedPaths(arg, heavyView.selection, true);
      return revealTarget(target);
    }),
    vscode.commands.registerCommand('speedStart.showStartupPerformance', () => showStartupPerformance()),
    vscode.commands.registerCommand('speedStart.showProcessExplorer', () => showProcessExplorer()),
    vscode.commands.registerCommand('speedStart.showRunningExtensions', () => showRunningExtensions()),
    vscode.commands.registerCommand('speedStart.startExtensionBisect', () => startExtensionBisect()),
    vscode.commands.registerCommand('speedStart.refreshExtensions', () => audit.refresh()),
    vscode.commands.registerCommand('speedStart.openExtension', (id?: string) => {
      if (!id) {
        return;
      }
      return openExtension(id);
    }),
  );
}

export function deactivate(): void {
  disposeLogger();
}

function positive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}
