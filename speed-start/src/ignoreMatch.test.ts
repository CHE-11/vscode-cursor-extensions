import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSafelyIgnored, parseIgnore, patternChoices, selectPatterns, toExcludeGlob, type ScopedIgnore } from './ignoreMatch';

function scopes(content: string, base = ''): ScopedIgnore[] {
  return [{ base, rules: parseIgnore(content) }];
}

test('comments and blank lines are skipped', () => {
  const rules = parseIgnore('\n# comment\n\n  \n');
  assert.equal(rules.length, 0);
  assert.equal(isSafelyIgnored('dist/a.js', false, [{ base: '', rules }]), false);
});

test('a directory pattern matches that directory anywhere, and its contents', () => {
  const rules = scopes('dist/');
  assert.equal(isSafelyIgnored('dist', true, rules), true);
  assert.equal(isSafelyIgnored('dist/a.js', false, rules), true);
  assert.equal(isSafelyIgnored('pkg/dist/a.js', false, rules), true);
  assert.equal(isSafelyIgnored('distribution/a.js', false, rules), false);
  assert.equal(isSafelyIgnored('dist', false, rules), false);
});

test('a rooted directory pattern stays at the ignore file root', () => {
  const rules = scopes('out/**');
  assert.equal(isSafelyIgnored('out/a.js', false, rules), true);
  assert.equal(isSafelyIgnored('pkg/out/a.js', false, rules), false);
});

test('node_modules and vsix patterns match nested paths', () => {
  const rules = scopes('**/node_modules/**\n*.vsix\n');
  assert.equal(isSafelyIgnored('node_modules', true, rules), true);
  assert.equal(isSafelyIgnored('packages/app/node_modules/left-pad/index.js', false, rules), true);
  assert.equal(isSafelyIgnored('builds/speed-start.vsix', false, rules), true);
  assert.equal(isSafelyIgnored('builds/speed-start.ts', false, rules), false);
});

test('a negation keeps the excepted path visible', () => {
  const rules = scopes('dist/\n!dist/keep.js\n');
  assert.equal(isSafelyIgnored('dist/a.js', false, rules), true);
  assert.equal(isSafelyIgnored('dist/keep.js', false, rules), false);
  assert.equal(isSafelyIgnored('dist', true, rules), true);
});

test('nested ignore files apply only under their directory', () => {
  const nested = scopes('dist/', 'packages/app');
  assert.equal(isSafelyIgnored('packages/app/dist/a.js', false, nested), true);
  assert.equal(isSafelyIgnored('other/dist/a.js', false, nested), false);
});

test('pattern choices offer a generic name for common build folders', () => {
  assert.deepEqual(patternChoices('packages/app/dist', true), ['packages/app/dist/', '**/dist/']);
  assert.deepEqual(patternChoices('dist', true), ['dist/', '**/dist/']);
  assert.deepEqual(patternChoices('packages/app/src', true), ['packages/app/src/']);
  assert.deepEqual(patternChoices('builds/ext.vsix', false), ['builds/ext.vsix']);
  assert.deepEqual(patternChoices('.next', true), ['.next/', '**/.next/']);
});

test('selectPatterns skips covered paths and collapses generic names', () => {
  const paths = [
    { relativePath: 'packages/web/dist', isDirectory: true },
    { relativePath: 'packages/api/dist', isDirectory: true },
    { relativePath: 'src', isDirectory: true },
  ];
  assert.deepEqual(selectPatterns(paths, 'specific', 'packages/web/dist/\n'), ['packages/api/dist/', 'src/']);
  assert.deepEqual(selectPatterns(paths, 'generic', ''), ['**/dist/', 'src/']);
  assert.deepEqual(selectPatterns([{ relativePath: 'dist/a.js', isDirectory: false }], 'specific', 'dist/\n'), []);
});

test('exclude globs cover a directory tree', () => {
  assert.equal(toExcludeGlob('packages/app/dist/'), 'packages/app/dist/**');
  assert.equal(toExcludeGlob('**/dist/'), '**/dist/**');
  assert.equal(toExcludeGlob('builds/a.vsix'), 'builds/a.vsix');
});
