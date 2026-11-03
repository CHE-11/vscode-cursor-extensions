const SYNC_MARKERS = ['MEGA', 'Dropbox', 'OneDrive', 'Google Drive', 'iCloud'];

export function detectSyncMarker(fsPath: string): string | undefined {
  const segments = fsPath.split(/[/\\]/).filter(Boolean);
  for (const marker of SYNC_MARKERS) {
    if (segments.some((segment) => segmentMatches(segment, marker))) {
      return marker;
    }
  }
  return undefined;
}

export function detectSyncMarkers(fsPaths: readonly string[]): string[] {
  const found: string[] = [];
  for (const fsPath of fsPaths) {
    const marker = detectSyncMarker(fsPath);
    if (marker && !found.includes(marker)) {
      found.push(marker);
    }
  }
  return found;
}

export function syncWarning(markers: readonly string[]): string | undefined {
  if (markers.length === 0) {
    return undefined;
  }
  return `This workspace is under ${markers.join(', ')}. Sync clients can rewrite timestamps and make Cursor scan again on each open.`;
}

function segmentMatches(segment: string, marker: string): boolean {
  const value = segment.toLowerCase();
  const needle = marker.toLowerCase();
  if (value === needle) {
    return true;
  }
  return value.startsWith(`${needle} `) || value.startsWith(`${needle}-`) || value.startsWith(`${needle}_`);
}
