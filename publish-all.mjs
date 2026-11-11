import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));

const extensions = findExtensions(repoRoot);
if (extensions.length === 0) {
  console.error('No extension builds found.');
  process.exit(1);
}

const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

const failures = [];
for (const extension of extensions) {
  const tag = `${extension.name}-v${extension.version}`;
  const title = `${extension.displayName} ${extension.version}`;
  console.log(`${extension.name}: ${extension.file}`);
  try {
    if (releaseExists(repo, tag)) {
      console.log(`Updating release ${tag}`);
      execFileSync('gh', ['release', 'upload', tag, extension.path, '--clobber', '--repo', repo], {
        cwd: repoRoot,
        stdio: 'inherit',
      });
    } else {
      console.log(`Creating release ${tag}`);
      execFileSync(
        'gh',
        [
          'release',
          'create',
          tag,
          extension.path,
          '--repo',
          repo,
          '--title',
          title,
          '--notes',
          releaseNotes(extension),
          '--latest=false',
        ],
        { cwd: repoRoot, stdio: 'inherit' },
      );
    }
  } catch (error) {
    failures.push(extension.name);
    console.error(`Failed to publish ${extension.name}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`Published with failures: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`Published ${extensions.length} releases to ${repo}.`);

function findExtensions(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const extensionDir = join(root, entry.name);
      const packagePath = join(extensionDir, 'package.json');
      if (!existsSync(packagePath)) return null;
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (!pkg.engines?.vscode || !pkg.name) return null;
      const build = latestVsix(extensionDir, pkg.name);
      if (!build) return null;
      return {
        name: pkg.name,
        displayName: pkg.displayName || pkg.name,
        description: pkg.description || '',
        version: build.version,
        file: build.file,
        path: build.path,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
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

function releaseExists(repo, tag) {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function releaseNotes(extension) {
  const lines = [extension.displayName];
  if (extension.description) lines.push('', extension.description);
  lines.push('', `Install the attached \`${extension.file}\` with **Extensions: Install from VSIX...**.`);
  return lines.join('\n');
}
