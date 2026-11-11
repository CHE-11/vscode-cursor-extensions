const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

const options = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
  },
  {
    ...shared,
    entryPoints: ['src/server/server.ts'],
    outfile: 'out/server.js',
  },
];

async function main() {
  if (watch) {
    const contexts = await Promise.all(options.map((option) => esbuild.context(option)));
    await Promise.all(contexts.map((context) => context.watch()));
    return;
  }
  await Promise.all(options.map((option) => esbuild.build(option)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
