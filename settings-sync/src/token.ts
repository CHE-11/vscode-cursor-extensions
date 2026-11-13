import * as vscode from 'vscode';
import { isPlausibleToken } from './safe';
import { readLocal, writeLocal } from './settings';
import { requestRefresh } from './refresh';
import type { App } from './app';

const SECRET_KEY = 'githubToken';

export async function getToken(context: vscode.ExtensionContext): Promise<string> {
  return ((await context.secrets.get(SECRET_KEY)) || '').trim();
}

export async function setToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store(SECRET_KEY, token.trim());
  requestRefresh();
}

export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
  requestRefresh();
}

export async function promptToken(context: vscode.ExtensionContext): Promise<string> {
  const value = await vscode.window.showInputBox({
    title: 'GitHub Personal Access Token',
    prompt: 'Create a token with the gist scope. It is stored in Secret Storage.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'ghp_...',
  });
  const token = (value || '').trim();
  if (!token) return '';
  if (!isPlausibleToken(token)) {
    void vscode.window.showErrorMessage('That does not look like a GitHub token.');
    return '';
  }
  await setToken(context, token);
  return token;
}

export async function migrateToken(app: App): Promise<void> {
  const { settings, legacyToken, changed } = await readLocal(app.userFolder);
  if (legacyToken) {
    const existing = await getToken(app.context);
    if (!existing && isPlausibleToken(legacyToken)) await setToken(app.context, legacyToken);
  }
  if (changed) await writeLocal(app.userFolder, settings);
}
