const { readFileSync } = require('fs');

for (const file of ['out/extension.js', 'out/server.js']) {
  const source = readFileSync(file, 'utf8');
  const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  const external = [...new Set(requires.filter((id) => !id.startsWith('.') && id !== 'vscode'))];
  console.log(file, 'bytes', source.length, 'external', external);
}
