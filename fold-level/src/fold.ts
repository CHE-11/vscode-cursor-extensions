export const FOLD_LEVELS = ['∞', '1', '2', '3', '4', '5', '6', '7'] as const;

export type FoldLevel = (typeof FOLD_LEVELS)[number];

export function levelsToShow(configured: readonly string[] | undefined): FoldLevel[] {
  if (!configured || configured.length === 0) {
    return [...FOLD_LEVELS];
  }
  return FOLD_LEVELS.filter((level) => configured.includes(level));
}

export function commandId(level: FoldLevel): string {
  if (level === '∞') {
    return 'fold-level.unfoldAll';
  }
  return `fold-level.foldLevel${level}`;
}

export function foldCommands(level: FoldLevel, foldSubLevels: boolean): string[] {
  if (level === '∞') {
    return [];
  }
  if (!foldSubLevels) {
    return [`editor.foldLevel${level}`];
  }

  const start = Number(level);
  const commands: string[] = [];
  for (let depth = 7; depth >= start; depth -= 1) {
    commands.push(`editor.foldLevel${depth}`);
  }
  return commands;
}

export function middleVisibleLine(ranges: readonly { startLine: number; endLine: number }[]): number | undefined {
  if (ranges.length === 0) {
    return undefined;
  }
  const startLine = ranges[0].startLine;
  const endLine = ranges[ranges.length - 1].endLine;
  return Math.round((startLine + endLine) / 2);
}
