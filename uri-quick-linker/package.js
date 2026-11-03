const { execSync } = require('child_process');
const { mkdirSync, existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const version = require('./package.json').version;
const outDir = join(__dirname, 'builds');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}
const outPath = join(outDir, `uri-quick-linker-${version}.vsix`);

const command = `pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license --out "${outPath}"`;
try {
  execSync(command, { stdio: 'inherit', shell: true, cwd: __dirname });
  console.log('Packaged URI Quick Linker...', outPath);
} catch (err) {
  console.error('Failed to package URI Quick Linker. Outpath: ', outPath, ' Error: ', err && err.status);
  process.exit(err && typeof err.status === 'number' ? err.status : 1);
}

try {
  trackNewestBuild('uri-quick-linker', version);
} catch (err) {
  console.error('Packaged URI Quick Linker, but failed to track the new build:', err && err.message);
  process.exit(err && typeof err.status === 'number' ? err.status : 1);
}

function trackNewestBuild(extensionName, version) {
  const repoRoot = join(__dirname, '..');
  const gitignorePath = join(repoRoot, '.gitignore');
  const relativeVsix = `${extensionName}/builds/${extensionName}-${version}.vsix`;
  const exception = `!${relativeVsix}`;
  const source = readFileSync(gitignorePath, 'utf8');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const pattern = new RegExp(`^!${extensionName}/builds/${extensionName}-.*\\.vsix`, 'm');
  let next = source;
  if (pattern.test(source)) {
    next = source.replace(pattern, exception);
  } else {
    const ignoreLine = `${extensionName}/builds/*`;
    if (source.includes(ignoreLine)) {
      next = source.replace(ignoreLine, `${ignoreLine}${newline}${exception}`);
    } else {
      const trimmed = source.replace(/\s*$/, '');
      next = `${trimmed}${newline}${newline}${ignoreLine}${newline}${exception}${newline}`;
    }
  }
  if (next !== source) {
    writeFileSync(gitignorePath, next);
  }

  const tracked = execSync(`git ls-files -- "${extensionName}/builds"`, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const file of tracked) {
    const normalized = file.replace(/\\/g, '/');
    if (normalized !== relativeVsix) {
      execSync(`git rm --cached -- "${normalized}"`, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
      });
    }
  }

  execSync(`git add -- "${relativeVsix}" .gitignore`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  console.log('Tracking', relativeVsix);
}
