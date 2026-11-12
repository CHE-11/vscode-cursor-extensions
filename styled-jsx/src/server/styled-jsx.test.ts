import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCSSLanguageService, Stylesheet } from 'vscode-css-languageservice';
import { LanguageModelCache } from './language-model-cache';
import { getStyledJsx, getStyledJsxUnderCursor, omitInterpolationDiagnostics } from './styled-jsx';

function cache(): LanguageModelCache<Stylesheet> {
  return {
    get() {
      return {};
    },
    onDocumentRemoved() {
      return undefined;
    },
    dispose() {
      return undefined;
    },
  };
}

function document(text: string): TextDocument {
  return TextDocument.create('file:///styled-jsx.tsx', 'typescriptreact', 1, text);
}

function maskedLines(text: string): string[] | undefined {
  return getStyledJsx(document(text), cache())?.cssDocument.getText().split('\n');
}

test('style jsx and css templates keep their css and blank the surrounding code', () => {
  const source = [
    'export const button = css`',
    '  button { color: red; }',
    '`;',
    'const View = () => (',
    '  <style jsx>{`',
    '    a { margin: 0; }',
    '  `}</style>',
    ');',
  ].join('\n');

  const styled = getStyledJsx(document(source), cache());
  const lines = styled?.cssDocument.getText().split('\n');
  assert.ok(styled);
  assert.equal(styled.cssDocument.getText().length, source.length);
  assert.equal(lines?.length, source.split('\n').length);
  assert.equal(lines?.[1], '  button { color: red; }');
  assert.equal(lines?.[5], '    a { margin: 0; }');
  assert.equal(lines?.[0].includes('export'), false);
  assert.equal(lines?.[3].includes('View'), false);
});

test('css.global and css.resolve templates are included', () => {
  const source = [
    'const shared = css.global`div { color: blue; }`;',
    'const resolved = css.resolve`section { display: flex; }`;',
  ].join('\n');

  const lines = maskedLines(source);
  assert.equal(lines?.[0].includes('div { color: blue; }'), true);
  assert.equal(lines?.[0].includes('shared'), false);
  assert.equal(lines?.[1].includes('section { display: flex; }'), true);
  assert.equal(lines?.[1].includes('resolved'), false);
});

test('jsx attribute order does not matter', () => {
  const source = [
    'const View = () => (',
    '  <style global jsx>{`',
    '    div { color: blue; }',
    '  `}</style>',
    ');',
  ].join('\n');

  assert.equal(maskedLines(source)?.[2], '    div { color: blue; }');
});

test('a style element that references a variable is not css', () => {
  const source = 'const View = () => <style jsx>{styles}</style>;\n';
  assert.equal(getStyledJsx(document(source), cache()), undefined);
});

test('css text inside a string or comment is not a template', () => {
  const stringSource = 'const sample = "css`a { color: red; }`";\n';
  const commentSource = '// css`a { color: red; }`\nconst value = 1;\n';
  assert.equal(getStyledJsx(document(stringSource), cache()), undefined);
  assert.equal(getStyledJsx(document(commentSource), cache()), undefined);
});

test('interpolations keep their place and stay valid css values, including multiline expressions', () => {
  const source = [
    'export const button = css`',
    '  button {',
    "    color: ${'red'};",
    '    padding: ${',
    '      large ? 50 : 20',
    '    }px;',
    '    content: "|";',
    '  }',
    '`;',
  ].join('\n');

  const styled = getStyledJsx(document(source), cache());
  const text = styled?.cssDocument.getText() ?? '';
  const lines = text.split('\n');
  const colorExpression = "${'red'}";
  assert.equal(text.length, source.length);
  assert.equal(lines.length, source.split('\n').length);
  assert.equal(lines[2], `    color: ${'x' + ' '.repeat(colorExpression.length - 1)};`);
  assert.equal(lines[3].includes('padding:'), true);
  assert.equal(lines[4].trim(), '');
  assert.equal(lines[5].endsWith('px;'), true);
  assert.equal(lines[6], '    content: "|";');
});

test('an interpolated property value is not a css error', () => {
  const sources = [
    [
      'export const button = css`',
      '  div {',
      '    background-color: ${myTheme.primary_bg};',
      '  }',
      '`;',
    ].join('\n'),
    [
      'const View = () => (',
      '  <style jsx>{`',
      '    div { background-color: ${myTheme.primary_bg}; }',
      '  `}</style>',
      ');',
    ].join('\n'),
  ];

  for (const source of sources) {
    assert.deepEqual(cssDiagnostics(source).map((item) => item.message), []);
  }
});

test('a missing property value is still reported beside an interpolation', () => {
  const source = [
    'export const button = css`',
    '  div {',
    '    background-color: ;',
    '    color: ${myTheme.primary_bg};',
    '  }',
    '`;',
  ].join('\n');

  const diagnostics = cssDiagnostics(source);
  assert.deepEqual(diagnostics.map((item) => item.message), ['property value expected']);
  const styled = getStyledJsx(document(source), cache());
  assert.ok(styled);
  assert.equal(source[styled.cssDocument.offsetAt(diagnostics[0].range.start)], ';');
});

function cssDiagnostics(source: string) {
  const service = getCSSLanguageService();
  const styled = getStyledJsx(document(source), {
    get(cssDocument) {
      return service.parseStylesheet(cssDocument);
    },
    onDocumentRemoved() {
      return undefined;
    },
    dispose() {
      return undefined;
    },
  });
  assert.ok(styled);
  return omitInterpolationDiagnostics(
    styled.cssDocument,
    service.doValidation(styled.cssDocument, styled.stylesheet, {}),
    styled.interpolations,
  );
}

test('language features are limited to the cursor inside a styled-jsx template', () => {
  const source = 'const resolved = css.resolve`div { display: flex; }`;\n';
  const open = document(source);
  const inside = source.indexOf('display');
  const outside = source.indexOf('resolved');
  assert.ok(getStyledJsxUnderCursor(open, cache(), inside));
  assert.equal(getStyledJsxUnderCursor(open, cache(), outside), undefined);
});
