import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionsFor, optionsMenu, optionActions, syncActions } from './options';

const optionLabels = [
  'Sync Location',
  'Select Local Folder',
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

const folderLabels = [
  'Sync Location',
  'Select Local Folder',
  'Edit Local Settings',
  'Open Settings',
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

const gistLabels = [
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
];

test('the options menu lists every setup action', () => {
  assert.deepEqual(optionsMenu().map((action) => action.label), optionLabels);
  for (const label of optionLabels) {
    assert.equal(optionActions.some((action) => action.label === label), true);
  }
});

test('each sync location shows its own setup actions', () => {
  assert.deepEqual(actionsFor('folder', optionsMenu()).map((action) => action.label), folderLabels);
  assert.deepEqual(actionsFor('gist', optionsMenu()).map((action) => action.label), gistLabels);
});

test('upload and download are sidebar actions and not options-menu duplicates', () => {
  assert.deepEqual(syncActions.map((action) => action.id), ['upload', 'download', 'clearAndUpload', 'viewLogs']);
  assert.equal(optionsMenu().some((action) => action.id === 'upload' || action.id === 'download' || action.id === 'viewLogs'), false);
});
