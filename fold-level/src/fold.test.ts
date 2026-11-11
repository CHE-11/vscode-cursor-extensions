import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLD_LEVELS, commandId, foldCommands, levelsToShow, middleVisibleLine } from './fold';

test('an unset or empty level list shows every button', () => {
  assert.deepEqual(levelsToShow(undefined), [...FOLD_LEVELS]);
  assert.deepEqual(levelsToShow([]), [...FOLD_LEVELS]);
});

test('configured buttons stay in status bar order and unknown values are dropped', () => {
  assert.deepEqual(levelsToShow(['3', 'nope', '∞', '3']), ['∞', '3']);
});

test('each level maps to one declared command', () => {
  assert.equal(commandId('∞'), 'fold-level.unfoldAll');
  assert.equal(commandId('1'), 'fold-level.foldLevel1');
  assert.equal(commandId('7'), 'fold-level.foldLevel7');
  assert.equal(new Set(FOLD_LEVELS.map(commandId)).size, FOLD_LEVELS.length);
});

test('infinity only unfolds, and sub-levels fold from 7 down through the chosen level', () => {
  assert.deepEqual(foldCommands('∞', false), []);
  assert.deepEqual(foldCommands('∞', true), []);
  assert.deepEqual(foldCommands('3', false), ['editor.foldLevel3']);
  assert.deepEqual(foldCommands('3', true), [
    'editor.foldLevel7',
    'editor.foldLevel6',
    'editor.foldLevel5',
    'editor.foldLevel4',
    'editor.foldLevel3',
  ]);
  assert.deepEqual(foldCommands('7', true), ['editor.foldLevel7']);
});

test('the scroll target is the middle of the visible ranges', () => {
  assert.equal(middleVisibleLine([]), undefined);
  assert.equal(middleVisibleLine([{ startLine: 10, endLine: 20 }]), 15);
  assert.equal(
    middleVisibleLine([
      { startLine: 4, endLine: 8 },
      { startLine: 40, endLine: 50 },
    ]),
    27,
  );
});
