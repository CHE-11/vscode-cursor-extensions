/**
 * Parses JSON with comments and trailing commas, the format VS Code accepts for tasks.json.
 */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripTrailingCommas(stripComments(stripBom(text)))) as T;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      result += char;
      if (char === '\\') {
        result += next ?? '';
        i += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      i++;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        // Keep newlines so JSON.parse error positions stay meaningful.
        if (text[i] === '\n') {
          result += '\n';
        }
        i++;
      }
      i += 2;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function stripTrailingCommas(text: string): string {
  let result = '';
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      result += char;
      if (char === '\\') {
        result += text[i + 1] ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) {
        j++;
      }
      if (text[j] === '}' || text[j] === ']') {
        continue;
      }
    }

    result += char;
  }

  return result;
}
