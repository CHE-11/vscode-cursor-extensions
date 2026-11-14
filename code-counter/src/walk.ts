const extensionPattern = /^\.[a-z0-9][a-z0-9+._-]*$/;

export function normalizeFileType(token: string): string {
  let value = token.trim().toLowerCase().replace(/\\/g, '/');
  const slash = value.lastIndexOf('/');
  if (slash >= 0) {
    value = value.slice(slash + 1);
  }
  if (value.startsWith('*.')) {
    value = value.slice(1);
  }
  if (value.startsWith('.')) {
    return value;
  }
  if (!value || value.includes('*') || value.includes('?') || value.includes('{')) {
    return value;
  }
  return `.${value}`;
}

export function canonicalFileType(input: string): string | undefined {
  const type = normalizeFileType(input);
  return extensionPattern.test(type) ? type : undefined;
}

export function splitFileTypeInput(input: string): string[] {
  return input.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

export function fileTypeExtensions(fileTypes: string[]): string[] {
  return [...new Set(fileTypes.map(normalizeFileType).filter((type) => extensionPattern.test(type)))];
}

export function fileMatchesTypes(filePath: string, fileTypes: string[]): boolean {
  const types = fileTypeExtensions(fileTypes);
  if (types.length === 0) {
    return true;
  }
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return types.some((type) => name.endsWith(type));
}

export function canonicalGlob(input: string): string | undefined {
  const value = input.trim();
  if (!value || /[\r\n]/.test(value)) {
    return undefined;
  }
  return value;
}

export function toBraceGlob(patterns: string[]): string {
  const list = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
  if (list.length === 0) {
    return '**/*';
  }
  if (list.length === 1) {
    return list[0];
  }
  return `{${list.join(',')}}`;
}

export function searchInclude(include: string[], fileTypes: string[]): string {
  const bases = include.map((pattern) => pattern.trim()).filter(Boolean);
  const patterns = bases.length > 0 ? bases : ['**/*'];
  const types = fileTypeExtensions(fileTypes);
  if (types.length === 0) {
    return toBraceGlob(patterns);
  }
  const expanded: string[] = [];
  for (const pattern of patterns) {
    if (selectsFiles(pattern)) {
      expanded.push(pattern);
    } else {
      for (const type of types) {
        expanded.push(appendExtension(pattern, type));
      }
    }
  }
  return toBraceGlob(expanded);
}

function selectsFiles(pattern: string): boolean {
  const last = pattern.split('/').pop() ?? pattern;
  if (last === '*' || last === '**' || last === '') {
    return false;
  }
  if (last.includes('.')) {
    return true;
  }
  return !last.includes('*') && !last.includes('?') && !last.includes('{');
}

function appendExtension(pattern: string, extension: string): string {
  if (pattern === '*') {
    return `*${extension}`;
  }
  if (pattern === '**') {
    return `**/*${extension}`;
  }
  if (pattern.endsWith('/*')) {
    return `${pattern}${extension}`;
  }
  if (pattern.endsWith('/')) {
    return `${pattern}**/*${extension}`;
  }
  if (pattern.endsWith('/**')) {
    return `${pattern}/*${extension}`;
  }
  return `${pattern}/**/*${extension}`;
}
