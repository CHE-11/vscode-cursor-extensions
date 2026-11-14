import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchBase } from './match';

describe('matchBase', () => {
  it('matches a pattern with no slash against the file name', () => {
    assert.equal(matchBase('src/file.ts', '*.ts'), true);
    assert.equal(matchBase('src/file.js', '*.ts'), false);
    assert.equal(matchBase('readme.md', '*.{md,txt}'), true);
    assert.equal(matchBase('readme.ts', '*.{md,txt}'), false);
  });

  it('matches a pattern with a slash against the full path', () => {
    assert.equal(matchBase('src/file.ts', 'src/*.ts'), true);
    assert.equal(matchBase('lib/src/file.ts', 'src/*.ts'), false);
    assert.equal(matchBase('a/b/file.ts', '**/file.ts'), true);
    assert.equal(matchBase('a/b/file.ts', '**/*.ts'), true);
  });
});
