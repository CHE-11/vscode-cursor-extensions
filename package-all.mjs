import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const latestDir = join(repoRoot, '_latest_builds_');

const extensions = findExtensions(repoRoot);
if (extensions.length === 0) {
  console.error('No extensions found.');
  process.exit(1);
}

mkdirSync(latestDir, { recursive: true });

const failures = [];
for (const extension of extensions) {
  console.log(`Starting: ${extension.name}`);
  try {
    if (!existsSync(join(extension.dir, 'node_modules'))) {
      runPnpm(['install'], extension.dir);
    }
    runPnpm(['run', 'package'], extension.dir);
    const copied = copyLatestBuild(extension, latestDir);
    console.log(`Completed: ${basename(copied)}\n`);
  } catch (error) {
    failures.push(extension.name);
    console.error(`Error packaging ${extension.name}: ${error.message}\n`);
  }
}

if (failures.length > 0) {
  console.error(`\nBuilt with failures: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`\nBuilt ${extensions.length} extensions into _latest_builds_.`);

function findExtensions(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => {
      const extensionDir = join(root, entry.name);
      const packagePath = join(extensionDir, 'package.json');
      if (!existsSync(packagePath)) return null;
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (!pkg.engines?.vscode || !pkg.name || !pkg.scripts?.package) return null;
      return { name: pkg.name, dir: extensionDir };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function runPnpm(args, cwd) {
  try {
    execFileSync('pnpm', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .map((part) => (part ? String(part).trim() : ''))
      .filter(Boolean)
      .join('\n');
    throw new Error(output || error.message);
  }
}

function copyLatestBuild(extension, destinationDir) {
  const build = latestVsix(extension.dir, extension.name);
  if (!build) {
    throw new Error('Package finished without producing a .vsix.');
  }

  const prefix = `${extension.name}-`;
  for (const file of readdirSync(destinationDir)) {
    if (file.startsWith(prefix) && file.endsWith('.vsix') && file !== build.file) {
      unlinkSync(join(destinationDir, file));
    }
  }

  const destination = join(destinationDir, build.file);
  copyFileSync(build.path, destination);
  return destination;
}

function latestVsix(extensionDir, name) {
  const buildsDir = join(extensionDir, 'builds');
  if (!existsSync(buildsDir)) return null;
  const prefix = `${name}-`;
  const builds = readdirSync(buildsDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.vsix'))
    .map((file) => ({
      file,
      version: file.slice(prefix.length, -'.vsix'.length),
      path: join(buildsDir, file),
    }))
    .filter((build) => /^\d+\.\d+\.\d+/.test(build.version));
  builds.sort((a, b) => compareVersions(b.version, a.version));
  return builds[0] ?? null;
}

function compareVersions(a, b) {
  const [aRelease, aPre = ''] = a.split('-', 2);
  const [bRelease, bPre = ''] = b.split('-', 2);
  const aParts = aRelease.split('.').map(Number);
  const bParts = bRelease.split('.').map(Number);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0);
    if (diff !== 0) return diff;
  }
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre < bPre ? -1 : 1;
}
