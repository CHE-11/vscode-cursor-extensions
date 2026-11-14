import * as path from 'node:path';

export interface RunOccupancy {
  unmatchedSends: number;
  openExecutions: number;
  busy: boolean;
}

export interface RunningSlot {
  codeFile: string | undefined;
  busy: boolean;
}

export function freshOccupancy(): RunOccupancy {
  return { unmatchedSends: 0, openExecutions: 0, busy: false };
}

export function sameRunTarget(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/**
 * Reuse the terminal for this file, or the most recent idle terminal.
 * A terminal that is still running a different file is left alone.
 */
export function pickRunningSlot<T extends RunningSlot>(slots: readonly T[], codeFile: string | undefined): T | undefined {
  const same = slots.find((slot) => sameRunTarget(slot.codeFile, codeFile));
  if (same) {
    return same;
  }
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index];
    if (slot && !slot.busy) {
      return slot;
    }
  }
  return undefined;
}

export function markCommandSent(state: RunOccupancy): void {
  state.unmatchedSends += 1;
  state.busy = true;
}

export function markExecutionStarted(state: RunOccupancy): void {
  state.openExecutions += 1;
  if (state.unmatchedSends > 0) {
    state.unmatchedSends -= 1;
  }
  state.busy = true;
}

export function markExecutionEnded(state: RunOccupancy): void {
  if (state.openExecutions > 0) {
    state.openExecutions -= 1;
  }
  state.busy = state.unmatchedSends > 0 || state.openExecutions > 0;
}

export function markStopped(state: RunOccupancy): void {
  state.unmatchedSends = 0;
  state.openExecutions = 0;
  state.busy = false;
}
