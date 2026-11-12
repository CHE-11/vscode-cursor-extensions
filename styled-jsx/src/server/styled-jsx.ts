import * as ts from 'typescript';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Stylesheet } from 'vscode-css-languageservice';
import { LanguageModelCache } from './language-model-cache';

export interface StyledJsxRange {
  start: number;
  end: number;
}

export interface StyledJsx {
  cssDocument: TextDocument;
  stylesheet: Stylesheet;
  interpolations: StyledJsxRange[];
}

export interface DiagnosticRange {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  code?: string | number;
}

const styledTagNames = new Set(['css', 'css.global', 'css.resolve']);
const styledJsxPattern = /(?:<\s*style\b[^>]*\bjsx\b[^>]*>|\bcss(?:\.(?:global|resolve))?\s*`)/g;

export function getApproximateStyledJsxOffsets(document: TextDocument): number[] {
  const results: number[] = [];
  const text = document.getText();
  styledJsxPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = styledJsxPattern.exec(text))) {
    results.push(match.index);
  }
  return results;
}

export function findStyledJsxRanges(document: TextDocument, offsets: number[]): StyledJsxRange[] {
  if (offsets.length === 0) {
    return [];
  }

  const sourceFile = ts.createSourceFile('styled-jsx.tsx', document.getText(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: StyledJsxRange[] = [];
  const seen = new Set<string>();

  for (const offset of offsets) {
    let node = findNodeAtOffset(sourceFile, offset);
    while (node) {
      const range = rangeForStyledJsxNode(node);
      if (range) {
        const key = `${range.start}:${range.end}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(range);
        }
        break;
      }
      node = node.parent;
    }
  }

  result.sort((left, right) => left.start - right.start);
  return result;
}

export function getStyledJsx(document: TextDocument, stylesheets: LanguageModelCache<Stylesheet>): StyledJsx | undefined {
  const offsets = getApproximateStyledJsxOffsets(document);
  const ranges = findStyledJsxRanges(document, offsets);
  if (ranges.length === 0) {
    return undefined;
  }
  return maskDocument(document, ranges, stylesheets);
}

export function getStyledJsxUnderCursor(
  document: TextDocument,
  stylesheets: LanguageModelCache<Stylesheet>,
  cursorOffset: number,
): StyledJsx | undefined {
  const ranges = findStyledJsxRanges(document, [cursorOffset]);
  const hit = ranges.some((range) => range.start <= cursorOffset && cursorOffset < range.end);
  if (!hit) {
    return undefined;
  }
  return maskDocument(document, ranges, stylesheets);
}

function findNodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | undefined {
  function visit(node: ts.Node): ts.Node | undefined {
    if (offset < node.getStart(sourceFile) || offset >= node.getEnd()) {
      return undefined;
    }
    for (const child of node.getChildren(sourceFile)) {
      const found = visit(child);
      if (found) {
        return found;
      }
    }
    return node;
  }
  return visit(sourceFile);
}

function rangeForStyledJsxNode(node: ts.Node): StyledJsxRange | undefined {
  if (isStyledJsxTaggedTemplate(node)) {
    return templateContentRange(node.template);
  }
  if (isStyledJsxTag(node)) {
    for (const child of node.children) {
      if (!ts.isJsxExpression(child) || !child.expression) {
        continue;
      }
      const expression = unwrapParentheses(child.expression);
      if (ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression)) {
        return templateContentRange(expression);
      }
    }
  }
  return undefined;
}

function isStyledJsxTaggedTemplate(node: ts.Node): node is ts.TaggedTemplateExpression {
  return ts.isTaggedTemplateExpression(node) && styledTagNames.has(tagText(node.tag) ?? '');
}

function tagText(tag: ts.Node): string | undefined {
  if (ts.isIdentifier(tag)) {
    return tag.text;
  }
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && ts.isIdentifier(tag.name)) {
    return `${tag.expression.text}.${tag.name.text}`;
  }
  return undefined;
}

function isStyledJsxTag(node: ts.Node): node is ts.JsxElement {
  if (!ts.isJsxElement(node)) {
    return false;
  }
  const openingName = node.openingElement.tagName;
  const closingName = node.closingElement.tagName;
  if (!ts.isIdentifier(openingName) || openingName.text !== 'style' || !ts.isIdentifier(closingName) || closingName.text !== 'style') {
    return false;
  }
  const attributeNames = node.openingElement.attributes.properties.map(attributeName);
  if (!attributeNames.includes('jsx')) {
    return false;
  }
  return node.children.some((child) => {
    if (!ts.isJsxExpression(child) || !child.expression) {
      return false;
    }
    const expression = unwrapParentheses(child.expression);
    return ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression);
  });
}

function attributeName(attribute: ts.JsxAttributeLike): string | undefined {
  if (!ts.isJsxAttribute(attribute)) {
    return undefined;
  }
  return ts.isIdentifier(attribute.name) ? attribute.name.text : attribute.name.getText();
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function templateContentRange(template: ts.TemplateLiteral): StyledJsxRange | undefined {
  const start = template.getStart() + 1;
  const end = template.getEnd() - 1;
  if (end < start) {
    return undefined;
  }
  return { start, end };
}

export function omitInterpolationDiagnostics<T extends DiagnosticRange>(
  document: TextDocument,
  diagnostics: T[],
  interpolations: readonly StyledJsxRange[],
): T[] {
  if (interpolations.length === 0 || diagnostics.length === 0) {
    return diagnostics;
  }
  return diagnostics.filter((diagnostic) => {
    return !diagnosticOverlapsInterpolation(document, diagnostic, interpolations)
      && !isEmptyInterpolatedValue(document, diagnostic, interpolations);
  });
}

function maskDocument(
  document: TextDocument,
  ranges: StyledJsxRange[],
  stylesheets: LanguageModelCache<Stylesheet>,
): StyledJsx {
  const text = document.getText();
  const parts: string[] = [];
  const interpolations: StyledJsxRange[] = [];
  let cursor = 0;

  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (end < start) {
      continue;
    }
    parts.push(blankNonNewlines(text.slice(cursor, start)));
    parts.push(replaceInterpolations(text.slice(start, end), start, interpolations));
    cursor = end;
  }
  parts.push(blankNonNewlines(text.slice(cursor)));

  const cssDocument = TextDocument.create(document.uri, 'css', document.version, parts.join(''));
  return {
    cssDocument,
    stylesheet: stylesheets.get(cssDocument),
    interpolations,
  };
}

function replaceInterpolations(css: string, offset: number, interpolations: StyledJsxRange[]): string {
  let result = '';
  for (let index = 0; index < css.length; index++) {
    if (css.startsWith('${', index)) {
      const expressionEnd = findInterpolationEnd(css, index + 2);
      const end = expressionEnd === -1 ? css.length : expressionEnd;
      interpolations.push({ start: offset + index, end: offset + end });
      result += interpolationPlaceholder(css.slice(index, end));
      index = end - 1;
      continue;
    }
    result += css[index];
  }
  return result;
}

// `${value}` is valid styled-jsx. A stand-in ident keeps the property from looking empty to the CSS checker.
function interpolationPlaceholder(text: string): string {
  let result = '';
  let insertedValue = false;
  for (const char of text) {
    if (char === '\n' || char === '\r') {
      result += char;
      continue;
    }
    if (!insertedValue) {
      result += 'x';
      insertedValue = true;
      continue;
    }
    result += ' ';
  }
  return result;
}

function diagnosticOverlapsInterpolation(
  document: TextDocument,
  diagnostic: DiagnosticRange,
  interpolations: readonly StyledJsxRange[],
): boolean {
  const start = document.offsetAt(diagnostic.range.start);
  const end = document.offsetAt(diagnostic.range.end);
  return interpolations.some((range) => start < range.end && end > range.start);
}

function isEmptyInterpolatedValue(
  document: TextDocument,
  diagnostic: DiagnosticRange,
  interpolations: readonly StyledJsxRange[],
): boolean {
  if (diagnostic.code !== 'css-propertyvalueexpected') {
    return false;
  }
  const text = document.getText();
  const errorAt = document.offsetAt(diagnostic.range.start);
  let colon = errorAt - 1;
  while (colon >= 0 && text[colon] !== ':' && text[colon] !== '{' && text[colon] !== ';' && text[colon] !== '}') {
    colon--;
  }
  if (text[colon] !== ':') {
    return false;
  }
  let sawInterpolation = false;
  for (let index = colon + 1; index < errorAt; index++) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      continue;
    }
    const inside = interpolations.some((range) => index >= range.start && index < range.end);
    if (!inside) {
      return false;
    }
    sawInterpolation = true;
  }
  return sawInterpolation;
}

function findInterpolationEnd(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(text, index);
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

function skipQuoted(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
      continue;
    }
    if (text[index] === quote) {
      return index;
    }
  }
  return text.length - 1;
}

function blankNonNewlines(text: string): string {
  return text.replace(/[^\n\r]/g, ' ');
}
