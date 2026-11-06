import { formatBytes, formatCount } from './format';
import type { StartupExtensionInfo } from './startupExtensions';

export interface PerfMark {
  name: string;
  startTime: number;
}

export interface StartupPerformanceInput {
  appName: string;
  version: string;
  appHost: string;
  remoteName?: string;
  uptimeMs?: number;
  heapUsed?: number;
  rss?: number;
  marks: readonly PerfMark[];
  startupExtensions: readonly StartupExtensionInfo[];
  names: Readonly<Record<string, string>>;
}

const WILL_PREFIX = 'code/extHost/willActivateExtension/';
const DID_PREFIX = 'code/extHost/didActivateExtension/';
const MAX_MARKS = 20000;
const MAX_TIMELINE = 40;
const MAX_ACTIVATIONS = 80;
const MAX_CHARS = 100000;

export function buildStartupPerformanceReport(input: StartupPerformanceInput): string {
  const marks = input.marks.filter(isPerfMark).slice(0, MAX_MARKS);
  const durations = activationDurations(marks);
  const lines: string[] = [
    'Speed Start — Startup Performance',
    '',
    'Extension host timeline. The built-in Startup Performance editor is not opened,',
    'because that report can freeze the window.',
    '',
    `${oneLine(input.appName, 80)} ${oneLine(input.version, 40)}`.trim(),
    `Host: ${oneLine(input.appHost, 40)}`,
    `Remote: ${input.remoteName ? oneLine(input.remoteName, 80) : 'local'}`,
  ];
  if (input.uptimeMs !== undefined) {
    lines.push(`Extension host uptime: ${formatUptime(input.uptimeMs)}`);
  }
  if (input.heapUsed !== undefined || input.rss !== undefined) {
    const parts: string[] = [];
    if (input.heapUsed !== undefined) {
      parts.push(`${formatBytes(input.heapUsed)} heap`);
    }
    if (input.rss !== undefined) {
      parts.push(`${formatBytes(input.rss)} rss`);
    }
    lines.push(`Memory: ${parts.join(', ')}`);
  }
  if (input.marks.length > marks.length) {
    lines.push(`Read the first ${formatCount(marks.length)} timing marks.`);
  }

  lines.push('', 'Extension host timeline', '');
  const timeline = hostTimeline(marks);
  if (timeline.length === 0) {
    lines.push('No extension host timing marks are available in this session.');
  } else {
    const shown = timeline.slice(0, MAX_TIMELINE);
    const origin = shown[0]?.startTime ?? 0;
    for (const mark of shown) {
      lines.push(`${formatCount(Math.round(mark.startTime - origin)).padStart(8)} ms  ${oneLine(mark.name, 120)}`);
    }
    if (timeline.length > shown.length) {
      lines.push(`${formatCount(timeline.length - shown.length)} more host marks omitted.`);
    }
  }

  lines.push('', 'Extension activation', '');
  const rows = [...durations.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (rows.length === 0) {
    lines.push('No extension activation timings yet.');
  } else {
    for (const [id, duration] of rows.slice(0, MAX_ACTIVATIONS)) {
      const name = input.names[id];
      const label = name && name !== id ? `${oneLine(name, 60)} (${oneLine(id, 80)})` : oneLine(id, 120);
      lines.push(`${formatCount(Math.round(duration)).padStart(8)} ms  ${label}`);
    }
    if (rows.length > MAX_ACTIVATIONS) {
      lines.push(`${formatCount(rows.length - MAX_ACTIVATIONS)} more activations omitted.`);
    }
  }

  const pending = input.startupExtensions.filter((extension) => !durations.has(extension.id));
  lines.push('', 'Startup extensions not activated yet', '');
  if (pending.length === 0) {
    lines.push('None.');
  } else {
    for (const extension of pending.slice(0, MAX_ACTIVATIONS)) {
      const group = extension.builtin ? 'built-in' : 'third-party';
      lines.push(`- ${oneLine(extension.displayName, 60)} (${oneLine(extension.id, 80)}, ${group}) — ${oneLine(extension.events.join(', '), 120)}`);
    }
    if (pending.length > MAX_ACTIVATIONS) {
      lines.push(`${formatCount(pending.length - MAX_ACTIVATIONS)} more startup extensions omitted.`);
    }
  }

  lines.push('');
  const text = lines.join('\n');
  if (text.length <= MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_CHARS)}\n\nReport truncated.\n`;
}

function isPerfMark(mark: PerfMark): boolean {
  return typeof mark?.name === 'string' && mark.name.length > 0 && typeof mark.startTime === 'number' && Number.isFinite(mark.startTime);
}

function activationDurations(marks: readonly PerfMark[]): Map<string, number> {
  const started = new Map<string, number>();
  const durations = new Map<string, number>();
  for (const mark of marks) {
    if (mark.name.startsWith(WILL_PREFIX)) {
      const id = mark.name.slice(WILL_PREFIX.length);
      if (id && !started.has(id)) {
        started.set(id, mark.startTime);
      }
    } else if (mark.name.startsWith(DID_PREFIX)) {
      const id = mark.name.slice(DID_PREFIX.length);
      const start = started.get(id);
      if (id && start !== undefined && !durations.has(id)) {
        durations.set(id, Math.max(0, mark.startTime - start));
      }
    }
  }
  return durations;
}

function hostTimeline(marks: readonly PerfMark[]): PerfMark[] {
  return marks
    .filter((mark) => mark.name.startsWith('code/') && !mark.name.startsWith(WILL_PREFIX) && !mark.name.startsWith(DID_PREFIX))
    .slice()
    .sort((left, right) => left.startTime - right.startTime || left.name.localeCompare(right.name));
}

function formatUptime(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${formatCount(minutes)} min ${rest} s`;
}

function oneLine(value: string, max: number): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, max - 1))}…`;
}
