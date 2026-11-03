import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSyncMarker, detectSyncMarkers, syncWarning } from './syncRoot';

test('sync markers match cloud-sync folders and not similar names', () => {
  assert.equal(detectSyncMarker('C:\\Users\\Connor\\Documents\\MEGA\\Repos\\app'), 'MEGA');
  assert.equal(detectSyncMarker('/Users/connor/Dropbox/app'), 'Dropbox');
  assert.equal(detectSyncMarker('C:\\Users\\Connor\\OneDrive - Contoso\\app'), 'OneDrive');
  assert.equal(detectSyncMarker('/Users/connor/Library/CloudStorage/Google Drive/app'), 'Google Drive');
  assert.equal(detectSyncMarker('/Users/connor/iCloud Drive/app'), 'iCloud');
  assert.equal(detectSyncMarker('/Users/connor/megaphone/app'), undefined);
  assert.equal(detectSyncMarker('C:\\Users\\Connor\\Projects\\app'), undefined);
});

test('sync warning names each marker once', () => {
  const markers = detectSyncMarkers(['C:\\MEGA\\one', 'D:\\MEGA\\two', 'D:\\Dropbox\\three']);
  assert.deepEqual(markers, ['MEGA', 'Dropbox']);
  assert.match(syncWarning(markers) ?? '', /MEGA, Dropbox/);
  assert.equal(syncWarning([]), undefined);
});
