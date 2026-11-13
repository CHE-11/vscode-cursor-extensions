import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OsType } from './enums';
import PragmaUtil from './pragmaUtil';

const testSettings = `{

    // @sync os=windows host=h1
    "setting.test": 1,

    // @sync os=windows host=h2
    "setting.test": 2,

    // @sync os=  linux host=  trim env= TEST_ENV 
    //"setting.test": 3,

    // @sync os=linux
    "not_commented": 4,

    // @sync host=_mac1_ os=mac
    "setting.test": 5,

    // @sync host=mac2 os=mac env=TEST_ENV
    //"mac2": 3,

    // @sync host=mac2
    //"server": "http://example.com",

    // @sync os=mac
    "mactest": "",

    // @sync host=test1
    "onlyHost": "",    

    // @sync-ignore
    "test4": 12,

    // @sync ignore
    "test5": 12
}`;

test('upload trims os, host, and env pragma values', async () => {
  const result = await PragmaUtil.processBeforeUpload(testSettings);
  assert.match(result, /@sync os=linux host=trim env=TEST_ENV/);
});

test('upload uncomments settings under a pragma', async () => {
  const commentedSettings = `
      // @sync os=linux
      // "window": 1,
      // @sync os=mac
      // "server": "http://exmaple.com
    `;
  const result = await PragmaUtil.processBeforeUpload(commentedSettings);
  assert.match(result, /\s+"window"/);
  assert.match(result, /\s+"server"/);
});

test('download comments settings for a different operating system', () => {
  const commentedSettings = `{
      // @sync os=linux
      // "linux": 1,
      // @sync os=mac
        "mac": 1
    }`;
  const processed = PragmaUtil.processBeforeWrite(commentedSettings, commentedSettings, OsType.Linux, null);
  assert.match(processed, /\s+"linux"/);
  assert.match(processed, /\s+\/\/\s+"mac"/);
});

test('linux settings stay uncommented', async () => {
  const uploaded = await PragmaUtil.processBeforeUpload(testSettings);
  const processed = PragmaUtil.processBeforeWrite(uploaded, uploaded, OsType.Linux, null);
  assert.match(processed, /\s+"not_commented"/);
});

test('only the matching os, host, and env block stays active', async () => {
  const uploaded = await PragmaUtil.processBeforeUpload(testSettings);
  process.env.TEST_ENV = '1';
  const processed = PragmaUtil.processBeforeWrite(uploaded, uploaded, OsType.Mac, 'mac2');
  assert.match(processed, /\n\s+"mac2"/);
  assert.match(processed, /\n\s+"mactest"/);
});

test('comments can be removed before the JSON is parsed', () => {
  const possibleJson = PragmaUtil.removeAllComments(testSettings);
  assert.doesNotThrow(() => JSON.parse(possibleJson));
});

test('multi-line blocks are commented together', () => {
  const commentedSettings = `{
      // @sync os=linux
      "multi": {
            "setting": false,
            "settingWithBrackets": "{} []",
            "multi": {
            }
      },
      // @sync os=mac
      "mac": 1
    }`;
  const processed = PragmaUtil.processBeforeWrite(commentedSettings, commentedSettings, OsType.Mac, null);
  assert.match(processed, /\/{2}\s+"multi"/);
  assert.match(processed, /\/{2}\s+"setting"/);
  assert.match(processed, /\/{2}\s+"settingWithBrackets"/);
  assert.match(processed, /\/{2}\s+},/);
  assert.match(processed, /\s+"mac"/);
});
