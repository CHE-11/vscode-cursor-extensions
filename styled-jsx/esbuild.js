const esbuild = require('esbuild');
const { join } = require('path');

const watch = process.argv.includes('--watch');
const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

// The package "main" is a UMD file that require()s ./parser/cssParser at
// runtime. Those calls are invisible to the bundler, so the packaged server
// crashes with MODULE_NOT_FOUND. The ESM build uses static imports.
const cssLanguageServiceEsm = join(__dirname, 'node_modules', 'vscode-css-languageservice', 'lib', 'esm', 'cssLanguageService.js');

const cssLanguageServiceEsmPlugin = {
  name: 'css-language-service-esm',
  setup(build) {
    build.onResolve({ filter: /^vscode-css-languageservice$/ }, () => ({
      path: cssLanguageServiceEsm,
    }));
  },
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
    plugins: [cssLanguageServiceEsmPlugin],
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
