import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const buildsDir = join(repoRoot, '_latest_builds_');

if (!existsSync(buildsDir)) {
  console.error('No _latest_builds_ directory found.');
  process.exit(1);
}

const vsixFiles = readdirSync(buildsDir)
  .filter((file) => file.endsWith('.vsix'))
  .sort((a, b) => a.localeCompare(b));

if (vsixFiles.length === 0) {
  console.error('No .vsix files found in _latest_builds_.');
  process.exit(1);
}

const cli = findCli();
const failures = [];

for (const file of vsixFiles) {
  const vsixPath = join(buildsDir, file);
  console.log(`Installing: ${file}`);
  try {
    installExtension(cli, vsixPath);
  } catch (error) {
    failures.push(file);
    console.error(`Failed to install ${file}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`Installed with failures: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`Installed ${vsixFiles.length} extensions with ${cli}.`);

function installExtension(cli, vsixPath) {
  const result = spawnSync(cli, ['--install-extension', vsixPath, '--force'], {
    cwd: repoRoot,
    shell: true,
    env: extensionCliEnv(),
    encoding: 'utf8',
  });
  const output = filterInstallLog(result.stdout);
  if (output) console.log(output);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(filterInstallLog(result.stderr) || `exit code ${result.status}`);
  }
}

function filterInstallLog(text) {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Installing extensions(\s+on .+)?\.\.\.$/.test(line))
    .join('\n');
}

function extensionCliEnv() {
  const flag = '--disable-warning=DEP0169';
  const flags = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(Boolean);
  if (!flags.includes(flag)) flags.push(flag);
  return { ...process.env, NODE_OPTIONS: flags.join(' ') };
}

function findCli() {
  for (const command of ['cursor', 'code']) {
    try {
      execFileSync(command, ['--version'], { stdio: 'ignore', shell: true });
      return command;
    } catch {
      // Try the next editor CLI.
    }
  }
  console.error('Neither cursor nor code CLI was found on PATH.');
  process.exit(1);
}
