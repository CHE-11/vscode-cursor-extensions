import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  levelToPercent,
  nextZoomLevel,
  normalizePresets,
  parseDisplayOrder,
  percentToDisplayString,
  percentToLevel,
  roundZoom,
  zoomInputError,
} from './zoom';

test('zoom level round-trips through the workbench 20 percent steps', () => {
  assert.equal(roundZoom(99.999), 100);
  assert.equal(roundZoom(100), 100);
  assert.equal(roundZoom(100.001), 100);
  assert.equal(roundZoom(levelToPercent(0)), 100);
  assert.equal(roundZoom(levelToPercent(1)), 120);
  assert.equal(roundZoom(levelToPercent(2)), 144);
  assert.equal(roundZoom(percentToLevel(100)), 0);
  assert.equal(roundZoom(percentToLevel(120)), 1);
  assert.equal(roundZoom(percentToLevel(144)), 2);
  assert.equal(percentToDisplayString(100, 'ja-JP'), '100%');
  assert.equal(percentToDisplayString(1000, 'ja-JP'), '1,000%');
});

test('multiplicative steps scale the current zoom and additive steps add the unit', () => {
  const multiplicativeIn = nextZoomLevel(0, 10, 'in', 'multiplicative');
  assert.ok(multiplicativeIn !== undefined);
  assert.equal(roundZoom(levelToPercent(multiplicativeIn)), 110);

  assert.equal(roundZoom(levelToPercent(nextZoomLevel(0, 10, 'in', 'additive') ?? 0)), 110);
  assert.equal(roundZoom(levelToPercent(nextZoomLevel(0, 10, 'out', 'additive') ?? 0)), 90);
  assert.equal(nextZoomLevel(percentToLevel(20), 20, 'out', 'additive'), undefined);
});

test('presets and display order drop duplicates and unknown tokens', () => {
  assert.deepEqual(normalizePresets([100, Number.NaN, 80, 100, 120]), [120, 100, 80]);
  assert.deepEqual(parseDisplayOrder('@+%-+x'), ['@', '+', '%', '-']);
});

test('zoom input accepts percentages inside the workbench range', () => {
  assert.equal(zoomInputError('150', 'Must be a number.', 'Range'), undefined);
  assert.equal(zoomInputError('ten', 'Must be a number.', 'Range'), 'Must be a number.');
  assert.equal(zoomInputError('10', 'Must be a number.', 'Range'), 'Range: 25 - 400');
});
