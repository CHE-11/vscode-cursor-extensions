import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionsFor, optionsMenu, optionActions, syncActions } from './options';

const optionLabels = [
  'Sync Location',
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
  'Chat Cap',
  'Per Chat Message Cap',
];

test('the options menu and the sidebar list the same setup actions', () => {
  assert.deepEqual(optionsMenu().map((action) => action.label), optionLabels);
  for (const label of optionLabels) {
    assert.equal(optionActions.some((action) => action.label === label), true);
  }
});

test('folder mode hides the gist setup actions', () => {
  const labels = actionsFor('folder', optionsMenu()).map((action) => action.label);
  assert.equal(labels.includes('Sync Location'), true);
  assert.equal(labels.includes('Edit Local Settings'), true);
  assert.equal(labels.includes('Set GitHub Token'), false);
  assert.equal(labels.includes('Choose Gist'), false);
  assert.equal(labels.includes('Download Public Gist'), false);
  assert.equal(labels.includes('Upload to a New Public Gist'), false);
  assert.deepEqual(actionsFor('gist', optionsMenu()).map((action) => action.label), optionLabels);
});

test('upload and download are sidebar actions and not options-menu duplicates', () => {
  assert.deepEqual(syncActions.map((action) => action.id), ['upload', 'download', 'clearAndUpload', 'viewLogs']);
  assert.equal(optionsMenu().some((action) => action.id === 'upload' || action.id === 'download' || action.id === 'viewLogs'), false);
});
