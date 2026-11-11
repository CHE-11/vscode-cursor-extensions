const { execSync } = require('child_process');
const { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } = require('fs');
const { basename, join } = require('path');

const pkg = require('./package.json');
const version = pkg.version;
const extensionName = pkg.name;
const outDir = join(__dirname, 'builds');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${extensionName}-${version}.vsix`);

const command = `pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license --out "${outPath}"`;
try {
  execSync(command, { stdio: 'inherit', shell: true, cwd: __dirname });
  console.log('Packaged Taskbar Zoom...', outPath);
} catch (err) {
  console.error('Failed to package Taskbar Zoom. Outpath: ', outPath, ' Error: ', err && err.status);
  process.exit(err && typeof err.status === 'number' ? err.status : 1);
}

try {
  trackNewestBuild(extensionName, version);
} catch (err) {
  console.error('Packaged Taskbar Zoom, but failed to track the new build:', err && err.message);
  process.exit(err && typeof err.status === 'number' ? err.status : 1);
}

function trackNewestBuild(extensionName, version) {
  const repoRoot = join(__dirname, '..');
  const latestDir = join(repoRoot, '_latest_builds_');
  mkdirSync(latestDir, { recursive: true });

  const fileName = `${extensionName}-${version}.vsix`;
  const relativeLatest = `_latest_builds_/${fileName}`;
  copyFileSync(join(__dirname, 'builds', fileName), join(latestDir, fileName));

  const prefixes = buildPrefixes(extensionName);
  for (const file of readdirSync(latestDir)) {
    if (isExtensionBuild(file, prefixes) && file !== fileName) {
      unlinkSync(join(latestDir, file));
    }
  }

  removeBuildFolderExceptions(repoRoot);

  const tracked = execSync('git ls-files -- "*.vsix"', {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const file of tracked) {
    const normalized = file.replace(/\\/g, '/');
    const inBuildFolder = !normalized.startsWith('_latest_builds_/');
    const olderLatest = normalized.startsWith('_latest_builds_/') && isExtensionBuild(normalized.slice('_latest_builds_/'.length), prefixes) && normalized !== relativeLatest;
    if (inBuildFolder || olderLatest) {
      execSync(`git rm --cached -f -- "${normalized}"`, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
      });
    }
  }

  execSync(`git add -- "${relativeLatest}" .gitignore`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  console.log('Tracking', relativeLatest);
}

function buildPrefixes(extensionName) {
  const prefixes = [`${extensionName}-`];
  const folderPrefix = `${basename(__dirname)}-`;
  if (folderPrefix !== prefixes[0]) prefixes.push(folderPrefix);
  return prefixes;
}

function isExtensionBuild(file, prefixes) {
  return file.endsWith('.vsix') && prefixes.some((prefix) => file.startsWith(prefix));
}

function removeBuildFolderExceptions(repoRoot) {
  const gitignorePath = join(repoRoot, '.gitignore');
  const source = readFileSync(gitignorePath, 'utf8');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const drop = /^(?:[A-Za-z0-9_.-]+\/builds\/\*|![A-Za-z0-9_.-]+\/builds\/.+\.vsix)$/;
  const kept = source.split(/\r?\n/).filter((line) => !drop.test(line));
  const next = `${kept.join(newline).replace(/(?:\r?\n){3,}/g, `${newline}${newline}`).replace(/\s*$/, '')}${newline}`;
  if (next !== source) {
    writeFileSync(gitignorePath, next);
  }
}
