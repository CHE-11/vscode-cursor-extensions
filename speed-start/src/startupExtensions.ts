export interface StartupExtensionInfo {
  id: string;
  displayName: string;
  isActive: boolean;
  events: string[];
  builtin: boolean;
}

export function isStartupEvent(event: string): boolean {
  return event === '*' || event === 'onStartupFinished' || event.startsWith('workspaceContains');
}

export function isBuiltinExtension(id: string): boolean {
  return id.startsWith('vscode.') || id.startsWith('anysphere.');
}

export function classifyExtension(
  id: string,
  displayName: string,
  isActive: boolean,
  events: readonly string[],
): StartupExtensionInfo | undefined {
  const startup = events.filter(isStartupEvent);
  if (startup.length === 0) {
    return undefined;
  }
  return {
    id,
    displayName: displayName || id,
    isActive,
    events: startup,
    builtin: isBuiltinExtension(id),
  };
}

export function compareStartupExtensions(left: StartupExtensionInfo, right: StartupExtensionInfo): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }
  return left.displayName.localeCompare(right.displayName);
}
