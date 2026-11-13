import assert from 'node:assert/strict';
import { test } from 'node:test';
import { optionsMenu, optionActions, syncActions } from './options';

const optionLabels = [
  'Set GitHub Token',
  'Choose Gist',
  'Edit Local Settings',
  'Open Settings',
  'Download Public Gist',
  'Upload to a New Public Gist',
  'Add Custom File',
  'Import Custom File into Workspace',
  'Toggle Auto Upload',
  'Toggle Auto Download',
  'Toggle Force Upload',
  'Toggle Force Download',
  'Toggle Quiet Summary',
  'Toggle Chat Sync',
];

test('the options menu and the sidebar list the same setup actions', () => {
  assert.deepEqual(optionsMenu().map((action) => action.label), optionLabels);
  for (const label of optionLabels) {
    assert.equal(optionActions.some((action) => action.label === label), true);
  }
});

test('upload and download are sidebar actions and not options-menu duplicates', () => {
  assert.deepEqual(syncActions.map((action) => action.id), ['upload', 'download']);
  assert.equal(optionsMenu().some((action) => action.id === 'upload' || action.id === 'download'), false);
});
