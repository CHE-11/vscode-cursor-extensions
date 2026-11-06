import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStartupPerformanceReport, type StartupPerformanceInput } from './startupPerformance';

const base: StartupPerformanceInput = {
  appName: 'Cursor',
  version: '1.0.0',
  appHost: 'desktop',
  marks: [],
  startupExtensions: [],
  names: {},
};

test('report shows host timeline offsets and activation durations', () => {
  const report = buildStartupPerformanceReport({
    ...base,
    uptimeMs: 12500,
    heapUsed: 180 * 1024 * 1024,
    marks: [
      { name: 'code/timeOrigin', startTime: 1000 },
      { name: 'code/extHost/willConnectToRenderer', startTime: 1120 },
      { name: 'code/extHost/ready', startTime: 2500 },
      { name: 'code/extHost/willActivateExtension/publisher.slow', startTime: 2600 },
      { name: 'code/extHost/didActivateExtension/publisher.slow', startTime: 3100 },
      { name: 'code/extHost/willActivateExtension/publisher.fast', startTime: 3200 },
      { name: 'code/extHost/didActivateExtension/publisher.fast', startTime: 3250 },
      { name: 'ignored', startTime: 4000 },
    ],
    names: { 'publisher.slow': 'Slow One' },
    startupExtensions: [
      {
        id: 'publisher.later',
        displayName: 'Later',
        isActive: false,
        events: ['onStartupFinished'],
        builtin: false,
      },
    ],
  });

  assert.match(report, /Extension host uptime: 12\.5 s/);
  assert.match(report, /180 MB heap/);
  assert.match(report, /0 ms {2}code\/timeOrigin/);
  assert.match(report, /120 ms {2}code\/extHost\/willConnectToRenderer/);
  assert.match(report, /1,500 ms {2}code\/extHost\/ready/);
  assert.match(report, /500 ms {2}Slow One \(publisher\.slow\)/);
  assert.match(report, /50 ms {2}publisher\.fast/);
  assert.match(report, /Later \(publisher\.later, third-party\) — onStartupFinished/);
  assert.doesNotMatch(report, /ignored/);
  assert.doesNotMatch(report, /willActivateExtension/);
});

test('missing marks still list startup extensions that have not activated', () => {
  const report = buildStartupPerformanceReport({
    ...base,
    remoteName: 'wsl',
    startupExtensions: [
      {
        id: 'vscode.git',
        displayName: 'Git',
        isActive: false,
        events: ['*'],
        builtin: true,
      },
    ],
  });

  assert.match(report, /Remote: wsl/);
  assert.match(report, /No extension host timing marks/);
  assert.match(report, /No extension activation timings yet/);
  assert.match(report, /Git \(vscode\.git, built-in\) — \*/);
});

test('activation report keeps the slowest entries and drops bad marks', () => {
  const marks = [{ name: 'code/timeOrigin', startTime: 0 }];
  for (let index = 0; index < 90; index += 1) {
    const id = `publisher.ext-${String(index).padStart(2, '0')}`;
    marks.push({ name: `code/extHost/willActivateExtension/${id}`, startTime: 1000 });
    marks.push({ name: `code/extHost/didActivateExtension/${id}`, startTime: 1000 + (90 - index) });
  }
  marks.push({ name: 'code/extHost/willActivateExtension/publisher.broken', startTime: Number.NaN });

  const report = buildStartupPerformanceReport({ ...base, marks });
  assert.match(report, /publisher\.ext-00/);
  assert.doesNotMatch(report, /publisher\.ext-89/);
  assert.match(report, /10 more activations omitted/);
  assert.doesNotMatch(report, /publisher\.broken/);
});
