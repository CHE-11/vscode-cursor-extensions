import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Count, LineCounter } from './LineCounter';

const counts = (count: Count) => ({ blank: count.blank, code: count.code, comment: count.comment });

describe('LineCounter', () => {
  it('separates code, comments, and blank lines', () => {
    const code = /* cpp */ `
      void main () {
        int x = 0;
        int y = 0; // code line

        // comment
        const char* str = "text";

        /*
          comment
          comment
        */
        int z = 100; /* code line
          comment
        */

        const char* hstr = R"(
          // not comment
          text

          /*
           not comment
          */

        )";
      }
    `;
    const counter = new LineCounter('cpp', ['//'], [['/*', '*/']], [['R"(', ')"']], [['"', '"']]);
    assert.deepEqual(counts(counter.count(code)), { blank: 4, code: 15, comment: 7 });
  });

  it('does not treat a comment marker inside a string as a comment', () => {
    const code = /* cs */ `
      Console.WriteLine("line 1");
      Console.WriteLine("line 2 /*");
      Console.WriteLine("line 3");
      Console.WriteLine("line 4");
    `;
    const counter = new LineCounter('c#', ['//'], [['/*', '*/']], [], [['"', '"']]);
    assert.deepEqual(counts(counter.count(code)), { blank: 1, code: 4, comment: 0 });
  });

  it('counts Python docstrings that start a line as comments', () => {
    const code = /* python */ `
"""
Module docsstring

Blaahblaah
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class MyContainer:
     """A custom container"""

    field_a: int
    """Field a blaah blaah"""

    field_b: str
    """Field b has a very long
    docstring"""


def __main__():
    print("""
        This is a very long text
        that is multiline
        it should be counted as code.
        """)
`;
    const counter = new LineCounter('python', ['#'], [['"""', '"""']], [['"""', '"""']], [['"', '"']], true);
    assert.deepEqual(counts(counter.count(code)), { blank: 8, code: 11, comment: 9 });
  });
});
