interface WorkingTreeChange {
  uri: { fsPath: string };
}

interface WorkingTreeRepository {
  state: { workingTreeChanges: readonly WorkingTreeChange[] };
}

export function hasDiff(fileName: string, repository: WorkingTreeRepository): boolean {
  return repository.state.workingTreeChanges.some((change) => change.uri.fsPath === fileName);
}

export function fileExtension(fileName: string): string | undefined {
  const extension = fileName.split(".").pop();
  return extension ? extension : undefined;
}

export function normalizeExtensions(extensions: readonly string[], caseSensitive: boolean): string[] {
  const stripped = extensions.map((ext) => (ext.startsWith(".") ? ext.slice(1) : ext));
  return caseSensitive ? stripped : stripped.map((ext) => ext.toLowerCase());
}

export function extensionMatches(fileName: string, extensions: readonly string[], caseSensitive: boolean): boolean {
  const extension = fileExtension(fileName);
  if (!extension) {
    return false;
  }
  const normalized = caseSensitive ? extension : extension.toLowerCase();
  return normalizeExtensions(extensions, caseSensitive).includes(normalized);
}
