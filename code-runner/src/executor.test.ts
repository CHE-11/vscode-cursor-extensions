import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCommand,
  matchGlob,
  placeholderContext,
  quote,
  resolveExecutor,
  toPowerShell,
  type ExecutorQuery,
} from './executor';

function query(overrides: Partial<ExecutorQuery> = {}): ExecutorQuery {
  return {
    baseName: 'app.py',
    languageId: 'python',
    fileExtension: '.py',
    firstLine: '',
    respectShebang: true,
    executorMap: { python: 'python -u', javascript: 'node' },
    executorMapByGlob: { 'pom.xml': 'cd $dir && mvn clean package' },
    executorMapByFileExtension: { '.vb': 'vbc', '.js': 'bun' },
    defaultLanguage: '',
    ...overrides,
  };
}

const ctx = placeholderContext('C:\\work\\src\\app.js', 'C:\\work', 'C:\\Python\\python.exe');

test('star, question mark, and exact names match the file name only', () => {
  assert.equal(matchGlob('app.test.js', '*.test.js'), true);
  assert.equal(matchGlob('app.test.js', '*.js'), true);
  assert.equal(matchGlob('app.js', '*.test.js'), false);
  assert.equal(matchGlob('pom.xml', 'pom.xml'), true);
  assert.equal(matchGlob('Pom.xml', 'pom.xml'), false);
  assert.equal(matchGlob('app.js', 'a??.js'), true);
  assert.equal(matchGlob('application.js', 'a??.js'), false);
  assert.equal(matchGlob('fileXname', 'file.name'), false);
});

test('glob wins over shebang and language, and the first pattern wins', () => {
  const resolved = resolveExecutor(query({
    baseName: 'pom.xml',
    languageId: 'xml',
    fileExtension: '.xml',
    firstLine: '#!/bin/bash',
  }));
  assert.equal(resolved.source, 'glob');
  assert.equal(resolved.command, 'cd $dir && mvn clean package');

  const first = resolveExecutor(query({
    baseName: 'app.test.js',
    languageId: 'javascript',
    fileExtension: '.js',
    executorMapByGlob: { '*.js': 'node', '*.test.js': 'tap' },
  }));
  assert.equal(first.command, 'node');
  const specific = resolveExecutor(query({
    baseName: 'app.test.js',
    languageId: 'javascript',
    fileExtension: '.js',
    executorMapByGlob: { '*.test.js': 'tap', '*.js': 'node' },
  }));
  assert.equal(specific.command, 'tap');
});

test('shebang is used when no glob matches, and rust attributes are not shebangs', () => {
  const shebang = resolveExecutor(query({
    baseName: 'script',
    languageId: 'plaintext',
    fileExtension: '',
    firstLine: '#!/usr/bin/env python',
    executorMap: {},
  }));
  assert.equal(shebang.source, 'shebang');
  assert.equal(shebang.command, '/usr/bin/env python');

  const rust = resolveExecutor(query({
    baseName: 'main.rs',
    languageId: 'rust',
    fileExtension: '.rs',
    firstLine: '#![allow(dead_code)]',
    executorMap: { rust: 'rustc' },
  }));
  assert.equal(rust.source, 'language');
  assert.equal(rust.command, 'rustc');

  const ignored = resolveExecutor(query({
    baseName: 'script',
    languageId: 'python',
    fileExtension: '.py',
    firstLine: '#!/usr/bin/env python3',
    respectShebang: false,
  }));
  assert.equal(ignored.source, 'language');
  assert.equal(ignored.command, 'python -u');
});

test('language beats extension, then extension, then the default language', () => {
  const language = resolveExecutor(query({
    baseName: 'app.js',
    languageId: 'javascript',
    fileExtension: '.js',
  }));
  assert.equal(language.source, 'language');
  assert.equal(language.command, 'node');

  const extension = resolveExecutor(query({
    baseName: 'Form.vb',
    languageId: 'vb',
    fileExtension: '.vb',
    executorMap: {},
  }));
  assert.equal(extension.source, 'extension');
  assert.equal(extension.languageId, '.vb');
  assert.equal(extension.command, 'vbc');

  const fallback = resolveExecutor(query({
    baseName: 'notes.zzz',
    languageId: 'unknown',
    fileExtension: '.zzz',
    executorMap: { python: 'python -u' },
    defaultLanguage: 'python',
  }));
  assert.equal(fallback.source, 'default');
  assert.equal(fallback.languageId, 'python');
  assert.equal(fallback.command, 'python -u');

  const none = resolveExecutor(query({
    baseName: 'notes.zzz',
    languageId: 'unknown',
    fileExtension: '.zzz',
    executorMap: {},
    executorMapByGlob: {},
  }));
  assert.equal(none.source, 'none');
  assert.equal(none.command, undefined);
});

test('an explicit language skips glob and shebang', () => {
  const resolved = resolveExecutor(query({
    baseName: 'pom.xml',
    languageId: 'xml',
    fileExtension: '.xml',
    firstLine: '#!/bin/bash',
    languageIdOverride: 'python',
  }));
  assert.equal(resolved.source, 'explicit');
  assert.equal(resolved.command, 'python -u');
  assert.equal(resolved.languageId, 'python');

  const missing = resolveExecutor(query({ languageIdOverride: 'cobol' }));
  assert.equal(missing.source, 'none');
  assert.equal(missing.command, undefined);
});

test('windows paths are quoted with forward slashes', () => {
  assert.equal(ctx.fullFileName, 'C:/work/src/app.js');
  assert.equal(ctx.dir, 'C:/work/src/');
  assert.equal(ctx.dirWithoutTrailingSlash, 'C:/work/src');
  assert.equal(ctx.fileName, 'app.js');
  assert.equal(ctx.fileNameWithoutExt, 'app');
  assert.equal(ctx.driveLetter, 'C:');
  assert.equal(ctx.workspaceRoot, 'C:/work');
  assert.equal(ctx.pythonPath, 'C:/Python/python.exe');
  assert.equal(quote('a"b'), '"a\\"b"');
});

test('commands without placeholders get the quoted file, and file placeholders are not doubled', () => {
  const spaced = placeholderContext('C:\\work\\my app.js', 'C:\\work', 'python');
  assert.equal(buildCommand('node', spaced, true), 'node "C:/work/my app.js"');
  assert.equal(buildCommand('python -u', ctx, true), 'python -u "C:/work/src/app.js"');
  assert.equal(
    buildCommand('cd $dir && mvn clean package', ctx, true),
    'cd "C:/work/src/" && mvn clean package',
  );
  assert.equal(
    buildCommand('cd $dir && javac $fileName && java $fileNameWithoutExt', ctx, true),
    'cd "C:/work/src/" && javac "app.js" && java "app"',
  );
  assert.equal(
    buildCommand('cd $dir && gcc $fileName -o $fileNameWithoutExt && $dir$fileNameWithoutExt', ctx, true),
    'cd "C:/work/src/" && gcc "app.js" -o "app" && "C:/work/src/app"',
  );
  assert.equal(buildCommand('$pythonPath -u $fullFileName', ctx, true), '"C:/Python/python.exe" -u "C:/work/src/app.js"');
  assert.equal(buildCommand('echo $driveLetter', ctx, true), 'echo C:');
  assert.equal(buildCommand('echo Hello', ctx, false), 'echo Hello');
  assert.equal(buildCommand('echo Hello', undefined, true), 'echo Hello');
});

test('powershell rewrites && chains and keeps the file name placeholder', () => {
  assert.equal(toPowerShell('node'), 'node');
  const command = buildCommand(
    toPowerShell('cd $dir && gcc $fileName -o $fileNameWithoutExt && $dir$fileNameWithoutExt'),
    placeholderContext('C:\\work\\src\\main.c', 'C:\\work', 'python'),
    true,
  );
  assert.equal(
    command,
    'cd "C:/work/src/" ; if ($?) { gcc "main.c" -o "main" } ; if ($?) { .\\"main" }',
  );
});
