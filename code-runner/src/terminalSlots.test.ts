import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  freshOccupancy,
  markCommandSent,
  markExecutionEnded,
  markExecutionStarted,
  markStopped,
  pickRunningSlot,
  sameRunTarget,
  type RunningSlot,
} from './terminalSlots';

function slot(codeFile: string | undefined, busy: boolean): RunningSlot {
  return { codeFile, busy };
}

test('the same file reuses its terminal while a different busy file does not', () => {
  const server = slot('C:/work/server.js', true);
  const idle = slot('C:/work/old.js', false);
  assert.equal(pickRunningSlot([server, idle], 'C:/work/server.js'), server);
  assert.equal(pickRunningSlot([server], 'C:/work/worker.js'), undefined);
  assert.equal(pickRunningSlot([server, idle], 'C:/work/worker.js'), idle);
});

test('an idle terminal is reused, preferring the most recent one', () => {
  const older = slot('C:/work/a.js', false);
  const newer = slot('C:/work/b.js', false);
  assert.equal(pickRunningSlot([older, newer], 'C:/work/c.js'), newer);
  assert.equal(pickRunningSlot([], 'C:/work/c.js'), undefined);
});

test('a custom command shares a terminal only with another custom command', () => {
  const custom = slot(undefined, true);
  const file = slot('C:/work/app.js', false);
  assert.equal(pickRunningSlot([custom, file], undefined), custom);
  assert.equal(pickRunningSlot([custom], 'C:/work/app.js'), undefined);
});

test('file paths match across separators and drive-letter case', () => {
  if (process.platform === 'win32') {
    assert.equal(sameRunTarget('C:/work/app.js', 'c:\\work\\app.js'), true);
  } else {
    assert.equal(sameRunTarget('/work/app.js', '/work/app.js'), true);
    assert.equal(sameRunTarget('/work/app.js', '/work/App.js'), false);
  }
  assert.equal(sameRunTarget(undefined, undefined), true);
  assert.equal(sameRunTarget(undefined, 'C:/work/app.js'), false);
  assert.equal(sameRunTarget('C:/work/app.js', 'C:/work/other.js'), false);
});

test('a terminal stays busy until each sent command finishes', () => {
  const state = freshOccupancy();
  markCommandSent(state);
  markExecutionStarted(state);
  markCommandSent(state);
  markExecutionEnded(state);
  assert.equal(state.busy, true);
  markExecutionStarted(state);
  markExecutionEnded(state);
  assert.equal(state.busy, false);
});

test('an end event does not clear a command whose start has not arrived', () => {
  const state = freshOccupancy();
  markCommandSent(state);
  markExecutionEnded(state);
  assert.equal(state.busy, true);
  assert.equal(state.unmatchedSends, 1);
});

test('stop clears occupancy so a later end event stays idle', () => {
  const state = freshOccupancy();
  markCommandSent(state);
  markExecutionStarted(state);
  markStopped(state);
  markExecutionEnded(state);
  assert.equal(state.busy, false);
  assert.equal(state.openExecutions, 0);
});
