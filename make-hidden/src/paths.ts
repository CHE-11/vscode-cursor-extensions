import * as path from 'path';
import * as vscode from 'vscode';

export interface PathInfo {
  basename: string;
  filename: string;
  extension: string;
  path: string;
}

export function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

export function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export function pathInfo(givenPath: string): PathInfo {
  const extension = path.extname(givenPath);
  const basename = path.basename(givenPath);
  return {
    basename,
    filename: extension === '' ? basename : basename.slice(0, -extension.length),
    extension,
    path: givenPath.slice(0, -basename.length),
  };
}

export function describeFile(chosenFilePath: string): {
  rootPath: string;
  relativePath: string;
  dirName: string;
  name: string;
  extension: string;
} {
  const rootPath = workspaceRoot();
  return {
    rootPath,
    relativePath: toPosix(path.relative(rootPath, chosenFilePath)),
    dirName: path.dirname(chosenFilePath),
    name: path.basename(chosenFilePath, path.extname(chosenFilePath)),
    extension: path.extname(chosenFilePath),
  };
}

export function relativeItem(root: string, directory: string, name: string): string {
  return toPosix(path.relative(root, path.join(directory, name)));
}
