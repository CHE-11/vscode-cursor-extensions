export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text));
}

function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += text.slice(start, i);
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += char;
    i++;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
