const { execSync } = require('child_process');
const { mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const version = require('./package.json').version;
const outDir = join(__dirname, 'builds');
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}
const outPath = join(outDir, `task-manager-${version}.vsix`);

const command = `pnpm dlx @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license --out "${outPath}"`;
try {
  execSync(command, { stdio: 'inherit', shell: true, cwd: __dirname });
  console.log('Packaged Task Manager...', outPath);
  process.exit(0);
} catch (err) {
  console.error('Failed to package Task Manager. Outpath: ', outPath, ' Error: ', err && err.status);
  process.exit(err && typeof err.status === 'number' ? err.status : 1);
}
