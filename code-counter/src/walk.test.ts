import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalFileType, fileMatchesTypes, searchInclude, splitFileTypeInput } from './walk';

describe('canonicalFileType', () => {
  it('normalizes an extension, a bare type, and a filename glob', () => {
    assert.equal(canonicalFileType('.TS'), '.ts');
    assert.equal(canonicalFileType('tsx'), '.tsx');
    assert.equal(canonicalFileType('*.d.ts'), '.d.ts');
    assert.equal(canonicalFileType('**/*.py'), '.py');
    assert.equal(canonicalFileType('src/**'), undefined);
    assert.equal(canonicalFileType(''), undefined);
  });
});

describe('splitFileTypeInput', () => {
  it('splits on commas and spaces', () => {
    assert.deepEqual(splitFileTypeInput(' .ts, tsx  .py '), ['.ts', 'tsx', '.py']);
  });
});

describe('fileMatchesTypes', () => {
  it('walks every file when no types are set', () => {
    assert.equal(fileMatchesTypes('src/a.py', []), true);
  });

  it('matches the extension and a compound suffix', () => {
    assert.equal(fileMatchesTypes('src/a.ts', ['.ts']), true);
    assert.equal(fileMatchesTypes('src\\a.TS', ['ts']), true);
    assert.equal(fileMatchesTypes('src/a.tsx', ['.ts']), false);
    assert.equal(fileMatchesTypes('src/a.d.ts', ['.d.ts']), true);
    assert.equal(fileMatchesTypes('src/a.d.ts', ['.ts']), true);
    assert.equal(fileMatchesTypes('src/a.js', ['.ts', '.py']), false);
  });
});

describe('searchInclude', () => {
  it('uses the include globs when no file types are set', () => {
    assert.equal(searchInclude(['**/*'], []), '**/*');
    assert.equal(searchInclude(['src/**', 'lib/**'], []), '{src/**,lib/**}');
    assert.equal(searchInclude([], []), '**/*');
  });

  it('limits a directory glob to the selected extensions', () => {
    assert.equal(searchInclude(['**/*'], ['.ts', '.tsx']), '{**/*.ts,**/*.tsx}');
    assert.equal(searchInclude(['src/**'], ['ts']), 'src/**/*.ts');
    assert.equal(searchInclude(['src/*'], ['.py']), 'src/*.py');
    assert.equal(searchInclude(['*'], ['.md']), '*.md');
    assert.equal(searchInclude(['docs/'], ['.md']), 'docs/**/*.md');
  });

  it('leaves a glob that already names a file', () => {
    assert.equal(searchInclude(['**/*.spec.ts'], ['.ts']), '**/*.spec.ts');
    assert.equal(searchInclude(['**/Makefile'], ['.ts']), '**/Makefile');
  });
});
