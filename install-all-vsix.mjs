import { execFileSync } from 'node:child_process';
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
    execFileSync(cli, ['--install-extension', vsixPath, '--force'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
    });
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
