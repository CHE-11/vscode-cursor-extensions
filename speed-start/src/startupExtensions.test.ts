import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyExtension, compareStartupExtensions, isBuiltinExtension, isStartupEvent } from './startupExtensions';

test('startup events are the broad activation events', () => {
  assert.equal(isStartupEvent('*'), true);
  assert.equal(isStartupEvent('onStartupFinished'), true);
  assert.equal(isStartupEvent('workspaceContains:package.json'), true);
  assert.equal(isStartupEvent('onLanguage:typescript'), false);
});

test('built-in extensions are vscode and cursor', () => {
  assert.equal(isBuiltinExtension('vscode.git'), true);
  assert.equal(isBuiltinExtension('anysphere.cursor-agent'), true);
  assert.equal(isBuiltinExtension('che-11.speed-start'), false);
});

test('classifyExtension keeps startup extensions and sorts active ones first', () => {
  assert.equal(classifyExtension('che-11.task-manager', 'Task Manager', true, ['onCommand:taskManager.refresh']), undefined);
  const active = classifyExtension('publisher.alpha', 'Alpha', true, ['*', 'onLanguage:json']);
  const idle = classifyExtension('publisher.beta', 'Beta', false, ['onStartupFinished']);
  assert.deepEqual(active?.events, ['*']);
  assert.equal(active?.builtin, false);
  assert.ok(active && idle && compareStartupExtensions(idle, active) > 0);
});
