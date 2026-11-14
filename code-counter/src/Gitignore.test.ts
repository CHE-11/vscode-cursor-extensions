import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Gitignore from './Gitignore';

describe('Gitignore', () => {
  it('applies root rules and a nested gitignore', () => {
    const parser = new Gitignore(`
# npm packages
node_modules/
package-lock.json

# build output
dist/
build/

# IDE files
.vscode/
.idea/

# except specific files
!.vscode/extensions.json
  `).merge(new Gitignore(`
# API specific ignores
*.log
temp/
config.local.js
`, 'src/api'));

    assert.equal(parser.includes('node_modules/express'), true);
    assert.equal(parser.includes('src/index.ts'), false);
    assert.equal(parser.includes('.vscode/settings.json'), true);
    assert.equal(parser.includes('.vscode/extensions.json'), false);
    assert.equal(parser.includes('src/api/temp/debug.log'), true);
    assert.equal(parser.includes('src/api/config.local.js'), true);
    assert.equal(parser.includes('src/web/config.local.js'), false);
  });

  it('lets a later negation win', () => {
    const parser = new Gitignore(`
*.log
!important.log
`).merge(new Gitignore(`
!debug.log
error.log
`, 'src/'));

    assert.equal(parser.includes('test.log'), true);
    assert.equal(parser.includes('important.log'), false);
    assert.equal(parser.includes('src/debug.log'), false);
    assert.equal(parser.includes('src/error.log'), true);
  });
});
