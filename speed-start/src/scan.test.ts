import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { test } from 'node:test';
import { scanWorkspace } from './scan';

test('scan reports heavy paths and skips ignored directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'speed-start-'));
  try {
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, 'secret'), { recursive: true });
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    await writeFile(path.join(root, '.cursorignore'), 'secret/\n');
    await writeFile(path.join(root, 'dist', 'app.js'), 'x'.repeat(50));
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'y'.repeat(80));
    await writeFile(path.join(root, 'secret', 'notes.txt'), 'hidden');
    await writeFile(path.join(root, 'big.bin'), Buffer.alloc(2 * 1024 * 1024));

    const result = await scanWorkspace({
      roots: [{ fsPath: root, name: 'fixture' }],
      directoryFileCount: 1,
      directoryBytes: 1024 * 1024,
      fileBytes: 1024 * 1024,
      maxEntries: 40,
      maxFilesVisited: 10000,
    });

    assert.ok(result.ignored.some((node) => node.relativePath === 'node_modules'));
    assert.ok(result.ignored.some((node) => node.relativePath === 'secret'));
    assert.equal(
      result.ignored.some((node) => node.relativePath.includes('pkg')),
      false,
    );
    assert.ok(result.candidates.some((node) => node.relativePath === 'big.bin' && node.byteSize === 2 * 1024 * 1024));
    const dist = result.candidates.find((node) => node.relativePath === 'dist');
    assert.ok(dist);
    assert.equal(dist?.fileCount, 1);
    assert.equal(
      result.candidates.some((node) => node.relativePath.includes('node_modules') || node.relativePath.includes('secret')),
      false,
    );
    assert.equal(result.capped, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
