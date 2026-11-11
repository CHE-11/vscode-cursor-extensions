export function getIndent(source: string, startOffset: number): number {
  let indent = 0;
  while (indent <= startOffset && source[startOffset - indent] !== '\n') {
    indent++;
  }
  return indent;
}
