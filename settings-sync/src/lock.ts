import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const STALE_MS = 120000;

export async function tryLock<T>(lockPath: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > STALE_MS) await unlink(lockPath);
  } catch {
    // There is no lock file yet.
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { busy: true };
    throw error;
  }

  try {
    return { busy: false, value: await fn() };
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
