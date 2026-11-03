const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
