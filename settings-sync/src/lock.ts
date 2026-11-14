import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const STALE_MS = 120000;

export async function tryLock<T>(lockPath: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await claim(lockPath);
  if (!handle) return { busy: true };

  try {
    await handle.writeFile(String(process.pid));
    return { busy: false, value: await fn() };
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

export function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function claim(lockPath: string): Promise<Awaited<ReturnType<typeof open>> | null> {
  await releaseDeadLock(lockPath);
  try {
    return await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await releaseDeadLock(lockPath);
  try {
    return await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
}

async function releaseDeadLock(lockPath: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    await unlinkIfStale(lockPath);
    return;
  }
  const pid = Number(text.trim());
  if (processIsRunning(pid)) return;
  await unlink(lockPath).catch(() => undefined);
}

async function unlinkIfStale(lockPath: string): Promise<void> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > STALE_MS) await unlink(lockPath);
  } catch {
    // The lock file is already gone.
  }
}
