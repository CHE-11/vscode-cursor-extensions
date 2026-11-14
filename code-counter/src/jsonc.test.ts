import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseJsonc } from './jsonc';

describe('parseJsonc', () => {
  it('reads JSONC language configuration files', () => {
    const text = `{
      // line comment
      "comments": {
        "lineComment": "//",
        "blockComment": ["/*", "*/"],
      },
      "url": "http://example.com",
      "note": "/* not a comment */",
    }`;
    assert.deepEqual(parseJsonc(text), {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      url: 'http://example.com',
      note: '/* not a comment */',
    });
  });
});
