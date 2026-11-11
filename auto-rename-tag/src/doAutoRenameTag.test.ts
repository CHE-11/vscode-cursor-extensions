import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doAutoRenameTag } from './doAutoRenameTag';

function renamed(
  text: string,
  offset: number,
  newWord: string,
  oldWord: string,
  languageId = 'html',
): string | undefined {
  const result = doAutoRenameTag(text, offset, newWord, oldWord, languageId);
  if (!result) {
    return undefined;
  }
  return text.slice(0, result.startOffset) + result.tagName + text.slice(result.endOffset);
}

test('renaming an opening tag updates the closing tag', () => {
  assert.equal(renamed('<divs>test</div>', 0, '<divs', '<div'), '<divs>test</divs>');
});

test('renaming a closing tag updates the opening tag', () => {
  const text = '<div>test</di>';
  assert.equal(renamed(text, text.lastIndexOf('<'), '</di', '</div'), '<di>test</di>');
});

test('a self-closing tag is skipped and is not given a pair', () => {
  assert.equal(renamed('<imgg src="a" />', 0, '<imgg', '<img'), undefined);
  assert.equal(renamed('<headd><link></head>', 0, '<headd', '<head'), '<headd><link></headd>');
});

test('a mismatched pair is left unchanged', () => {
  assert.equal(renamed('<divs>test</span>', 0, '<divs', '<div'), undefined);
});
