import * as vscode from 'vscode';
import { pgFunctions, type PgFunction } from './functions';

const NL = '\n'.charCodeAt(0);
const TAB = '\t'.charCodeAt(0);
const SPACE = ' '.charCodeAt(0);
const L_BRACKET = '['.charCodeAt(0);
const R_BRACKET = ']'.charCodeAt(0);
const L_CURLY = '{'.charCodeAt(0);
const R_CURLY = '}'.charCodeAt(0);
const L_PAREN = '('.charCodeAt(0);
const R_PAREN = ')'.charCodeAt(0);
const COMMA = ','.charCodeAt(0);
const QUOTE = "'".charCodeAt(0);
const DQUOTE = '"'.charCodeAt(0);

const signaturesByName = new Map<string, PgFunction[]>();

for (const entry of pgFunctions) {
  const name = functionName(entry.signature);
  if (!name) {
    continue;
  }
  const existing = signaturesByName.get(name);
  if (existing) {
    existing.push(entry);
  } else {
    signaturesByName.set(name, [entry]);
  }
}

export function functionName(signature: string): string | undefined {
  const trimmed = signature.trim();
  const paren = trimmed.indexOf('(');
  const head = paren === -1 ? trimmed : trimmed.slice(0, paren);
  const match = /[A-Za-z_][A-Za-z0-9_]*/.exec(head);
  return match?.[0].toUpperCase();
}

export function parameterLabels(signature: string): string[] {
  const open = signature.indexOf('(');
  if (open < 0) {
    return [];
  }
  const close = signature.indexOf(')', open);
  if (close < 0) {
    return [];
  }
  const inner = signature.slice(open + 1, close).trim();
  if (inner.length === 0) {
    return [];
  }
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

class BackwardIterator {
  private line: string;

  constructor(
    private readonly document: vscode.TextDocument,
    private offset: number,
    private lineNumber: number,
  ) {
    this.line = document.lineAt(lineNumber).text;
  }

  hasNext(): boolean {
    return this.lineNumber >= 0;
  }

  next(): number {
    if (this.offset < 0) {
      if (this.lineNumber > 0) {
        this.lineNumber -= 1;
        this.line = this.document.lineAt(this.lineNumber).text;
        this.offset = this.line.length - 1;
        return NL;
      }
      this.lineNumber = -1;
      return 0;
    }
    const code = this.line.charCodeAt(this.offset);
    this.offset -= 1;
    return code;
  }
}

function isIdentPart(code: number): boolean {
  return (
    code === '_'.charCodeAt(0) ||
    (code >= 'a'.charCodeAt(0) && code <= 'z'.charCodeAt(0)) ||
    (code >= 'A'.charCodeAt(0) && code <= 'Z'.charCodeAt(0)) ||
    (code >= '0'.charCodeAt(0) && code <= '9'.charCodeAt(0)) ||
    (code >= 0x80 && code <= 0xffff)
  );
}

function countArguments(iterator: BackwardIterator): number {
  let parentNesting = 0;
  let bracketNesting = 0;
  let curlyNesting = 0;
  let paramCount = 0;

  while (iterator.hasNext()) {
    const code = iterator.next();
    switch (code) {
      case L_PAREN:
        parentNesting -= 1;
        if (parentNesting < 0) {
          return paramCount;
        }
        break;
      case R_PAREN:
        parentNesting += 1;
        break;
      case L_CURLY:
        curlyNesting -= 1;
        break;
      case R_CURLY:
        curlyNesting += 1;
        break;
      case L_BRACKET:
        bracketNesting -= 1;
        break;
      case R_BRACKET:
        bracketNesting += 1;
        break;
      case DQUOTE:
      case QUOTE:
        while (iterator.hasNext() && code !== iterator.next()) {
          // Skip until the closing quote.
        }
        break;
      case COMMA:
        if (parentNesting === 0 && bracketNesting === 0 && curlyNesting === 0) {
          paramCount += 1;
        }
        break;
      default:
        break;
    }
  }
  return -1;
}

function readIdent(iterator: BackwardIterator): string {
  let identStarted = false;
  let ident = '';
  while (iterator.hasNext()) {
    const code = iterator.next();
    if (!identStarted && (code === SPACE || code === TAB || code === NL)) {
      continue;
    }
    if (isIdentPart(code)) {
      identStarted = true;
      ident = String.fromCharCode(code) + ident;
    } else if (identStarted) {
      return ident;
    }
  }
  return ident;
}

function toSignatureInformation(entry: PgFunction): vscode.SignatureInformation {
  const info = new vscode.SignatureInformation(entry.signature.trim(), entry.documentation);
  for (const label of parameterLabels(entry.signature)) {
    info.parameters.push(new vscode.ParameterInformation(label));
  }
  return info;
}

export class PostgresqlSignatureHelpProvider implements vscode.SignatureHelpProvider {
  provideSignatureHelp(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.SignatureHelp | undefined {
    const iterator = new BackwardIterator(document, position.character - 1, position.line);
    const paramCount = countArguments(iterator);
    if (paramCount < 0) {
      return undefined;
    }

    const ident = readIdent(iterator);
    if (!ident) {
      return undefined;
    }

    const entries = signaturesByName.get(ident.toUpperCase());
    if (!entries || entries.length === 0) {
      return undefined;
    }

    const help = new vscode.SignatureHelp();
    help.signatures = entries.map(toSignatureInformation);
    const matchIndex = entries.findIndex((entry) => parameterLabels(entry.signature).length > paramCount);
    help.activeSignature = matchIndex === -1 ? entries.length - 1 : matchIndex;
    const active = help.signatures[help.activeSignature];
    const parameterCount = active?.parameters.length ?? 0;
    help.activeParameter = parameterCount === 0 ? 0 : Math.min(paramCount, parameterCount - 1);
    return help;
  }
}
