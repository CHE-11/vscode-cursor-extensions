import { formatBytes, formatCount } from './format';
import { patternChoices } from './ignoreMatch';
import type { ScanNode, ScanResult } from './scan';
import type { StartupExtensionInfo } from './startupExtensions';
import { syncWarning } from './syncRoot';

export function buildReport(result: ScanResult, extensions: readonly StartupExtensionInfo[]): string {
  const lines: string[] = ['# Speed Start', ''];
  const warning = syncWarning(result.syncMarkers);
  if (warning) {
    lines.push(warning, '');
  }
  lines.push(`Visited ${formatCount(result.visited)} entries.`);
  if (result.cancelled) {
    lines.push('Scan cancelled. Results are partial.');
  }
  if (result.capped) {
    lines.push('Scan stopped at the visit limit.');
  }
  if (result.listCapped) {
    lines.push(`Showing the ${formatCount(result.candidates.length)} heaviest paths.`);
  }
  if (result.ignoredCapped) {
    lines.push(`Showing ${formatCount(result.ignored.length)} ignored directories.`);
  }
  if (result.unreadable > 0) {
    lines.push(`${formatCount(result.unreadable)} directories could not be read.`);
  }

  lines.push('', '## Not ignored', '');
  if (result.candidates.length === 0) {
    lines.push('None.');
  } else {
    writeNodes(result.candidates, '', lines);
  }

  lines.push('', '## Already ignored', '');
  if (result.ignored.length === 0) {
    lines.push('None.');
  } else {
    for (const node of result.ignored) {
      lines.push(`- \`${node.workspaceName}/${node.relativePath}/\` — ignored, not scanned`);
    }
  }

  const suggestions = suggestedPatterns(result.candidates);
  lines.push('', '## Suggested ignore lines', '');
  if (suggestions.length === 0) {
    lines.push('None.');
  } else {
    for (const pattern of suggestions) {
      lines.push(`- \`${pattern}\``);
    }
  }

  lines.push('', '## Startup extensions', '');
  if (extensions.length === 0) {
    lines.push('None.');
  } else {
    for (const extension of extensions) {
      const group = extension.builtin ? 'built-in' : 'third-party';
      lines.push(`- ${extension.displayName} (${extension.id}, ${group}, ${extension.isActive ? 'active' : 'inactive'}) — ${extension.events.join(', ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function writeNodes(nodes: readonly ScanNode[], indent: string, lines: string[]): void {
  for (const node of nodes) {
    lines.push(`${indent}- ${nodeLabel(node)}`);
    if (node.children.length > 0) {
      writeNodes(node.children, `${indent}  `, lines);
    }
  }
}

function nodeLabel(node: ScanNode): string {
  const location = `\`${node.workspaceName}/${node.relativePath}${node.kind === 'directory' ? '/' : ''}\``;
  if (node.kind === 'file') {
    return `${location} — ${formatBytes(node.byteSize)}`;
  }
  return `${location} — ${formatCount(node.fileCount)} files, ${formatBytes(node.byteSize)}`;
}

function suggestedPatterns(nodes: readonly ScanNode[]): string[] {
  const patterns: string[] = [];
  const visit = (node: ScanNode): void => {
    if (!node.ignored) {
      const [specific] = patternChoices(node.relativePath, node.kind === 'directory');
      if (specific && !patterns.includes(specific)) {
        patterns.push(specific);
      }
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return patterns;
}
