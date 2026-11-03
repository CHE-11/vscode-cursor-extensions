const GENERIC_DIR_NAMES = new Set(['dist', 'build', 'coverage', 'node_modules', 'out', '.next', '.turbo']);

export type PatternStyle = 'specific' | 'generic';

export interface IgnoreRule {
  negated: boolean;
  directoryOnly: boolean;
  regex: RegExp;
  source: string;
}

export interface ScopedIgnore {
  base: string;
  rules: IgnoreRule[];
}

export interface PatternTarget {
  relativePath: string;
  isDirectory: boolean;
}

export function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function parseIgnore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    let body = line;
    let negated = false;
    if (body.startsWith('!')) {
      negated = true;
      body = body.slice(1).trim();
    }
    if (!body || body.startsWith('#')) {
      continue;
    }
    const compiled = compilePattern(body);
    if (compiled) {
      rules.push({ negated, source: body, ...compiled });
    }
  }
  return rules;
}

export function isSafelyIgnored(relativePath: string, isDirectory: boolean, scopes: ScopedIgnore[]): boolean {
  const path = normalizeRelative(relativePath);
  if (!path) {
    return false;
  }
  let ignored = false;
  let negated = false;
  for (const scope of scopes) {
    const relativeToBase = remainder(path, normalizeRelative(scope.base));
    if (relativeToBase === undefined || relativeToBase === '') {
      continue;
    }
    for (const rule of scope.rules) {
      if (!ruleMatches(rule, relativeToBase, isDirectory)) {
        continue;
      }
      if (rule.negated) {
        negated = true;
      } else {
        ignored = true;
      }
    }
  }
  if (negated) {
    return false;
  }
  return ignored;
}

export function patternChoices(relativePath: string, isDirectory: boolean): string[] {
  const normalized = normalizeRelative(relativePath);
  if (!normalized) {
    return [];
  }
  const specific = isDirectory ? `${normalized}/` : normalized;
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (isDirectory && GENERIC_DIR_NAMES.has(name)) {
    const generic = `**/${name}/`;
    return specific === generic ? [specific] : [specific, generic];
  }
  return [specific];
}

export function selectPatterns(paths: readonly PatternTarget[], style: PatternStyle, existingContent: string): string[] {
  const scopes: ScopedIgnore[] = [{ base: '', rules: parseIgnore(existingContent) }];
  const chosen: string[] = [];
  for (const entry of paths) {
    const relativePath = normalizeRelative(entry.relativePath);
    if (!relativePath || isSafelyIgnored(relativePath, entry.isDirectory, scopes)) {
      continue;
    }
    const choices = patternChoices(relativePath, entry.isDirectory);
    const pattern = style === 'generic' && choices.length > 1 ? choices[1] : choices[0];
    if (!pattern || chosen.includes(pattern) || hasExactPattern(existingContent, pattern)) {
      continue;
    }
    chosen.push(pattern);
  }
  return chosen;
}

export function hasGenericChoice(paths: readonly PatternTarget[]): boolean {
  return paths.some((entry) => patternChoices(entry.relativePath, entry.isDirectory).length > 1);
}

export function toExcludeGlob(pattern: string): string {
  return pattern.endsWith('/') ? `${pattern}**` : pattern;
}

function hasExactPattern(content: string, pattern: string): boolean {
  return content.split(/\r?\n/).some((line) => line.trim() === pattern);
}

function remainder(path: string, base: string): string | undefined {
  if (!base) {
    return path;
  }
  if (path === base) {
    return '';
  }
  if (path.startsWith(`${base}/`)) {
    return path.slice(base.length + 1);
  }
  return undefined;
}

function ruleMatches(rule: IgnoreRule, relativePath: string, isDirectory: boolean): boolean {
  if (!rule.regex.test(relativePath)) {
    return false;
  }
  if (rule.directoryOnly && !relativePath.includes('/') && !isDirectory) {
    return false;
  }
  return true;
}

function compilePattern(pattern: string): { regex: RegExp; directoryOnly: boolean } | undefined {
  const original = pattern.replace(/\\/g, '/').trim();
  if (!original) {
    return undefined;
  }
  let source = original;
  let directoryOnly = false;
  const anchored = isAnchored(source);
  if (source.endsWith('/**')) {
    directoryOnly = true;
    source = source.slice(0, -3);
  } else if (source.endsWith('/')) {
    directoryOnly = true;
    source = source.slice(0, -1);
  }
  if (!source || source === '*' || source === '**') {
    return { regex: /^.*$/, directoryOnly };
  }
  if (source.startsWith('/')) {
    source = source.slice(1);
  }
  if (!anchored) {
    source = `**/${source}`;
  }
  const body = globToRegex(source);
  return { regex: new RegExp(`^${body}(?:/.*)?$`), directoryOnly };
}

function isAnchored(pattern: string): boolean {
  const withoutTrailingSlash = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  return withoutTrailingSlash.includes('/');
}

function globToRegex(pattern: string): string {
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 3;
          continue;
        }
        expression += '.*';
        index += 2;
        continue;
      }
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (char === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    if (/[\\^$.+()|[\]{}]/.test(char)) {
      expression += `\\${char}`;
      index += 1;
      continue;
    }
    expression += char;
    index += 1;
  }
  return expression;
}
