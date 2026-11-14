const regexpChar = /[.*+?^${}()|[\]\\]/g;

export function matchBase(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const glob = pattern.replace(/\\/g, '/');
  if (!glob.includes('/')) {
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    return compileGlob(glob).test(name);
  }
  return compileGlob(glob).test(normalized);
}

function compileGlob(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '{') {
      const end = pattern.indexOf('}', i);
      if (end > i) {
        const parts = pattern.slice(i + 1, end).split(',').map((part) => part.replace(regexpChar, '\\$&'));
        source += `(?:${parts.join('|')})`;
        i = end;
        continue;
      }
    }
    source += char.replace(regexpChar, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
