import * as vscode from 'vscode';

const STORAGE_KEY = 'makeHidden.workspaces';

export interface SavedWorkspace {
  id: string;
  name: string;
  path: string | null;
  excludedItems: string[];
}

export function listWorkspaces(context: vscode.ExtensionContext, paths: Array<string | null>): SavedWorkspace[] {
  return readWorkspaces(context).filter((workspace) => paths.includes(workspace.path));
}

export async function saveWorkspace(
  context: vscode.ExtensionContext,
  name: string,
  excludedItems: readonly string[],
  workspacePath: string | null,
): Promise<void> {
  const workspace: SavedWorkspace = {
    id: createId(),
    name,
    path: workspacePath,
    excludedItems: [...excludedItems],
  };
  await context.globalState.update(STORAGE_KEY, [...readWorkspaces(context), workspace]);
}

export async function deleteWorkspace(context: vscode.ExtensionContext, id: string): Promise<void> {
  const remaining = readWorkspaces(context).filter((workspace) => workspace.id !== id);
  await context.globalState.update(STORAGE_KEY, remaining);
}

function readWorkspaces(context: vscode.ExtensionContext): SavedWorkspace[] {
  return context.globalState.get<SavedWorkspace[]>(STORAGE_KEY, []);
}

function createId(): string {
  const block = () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  return `${block()}-${block()}`;
}
