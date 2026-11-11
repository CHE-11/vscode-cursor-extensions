import * as vscode from 'vscode';
import { doAutoRenameTag } from './doAutoRenameTag';

interface Tag {
  word: string;
  offset: number;
  oldWord: string;
  previousOffset: number;
}

interface AppliedRename {
  startOffset: number;
  endOffset: number;
  tagName: string;
  originalOffset: number;
  originalWord: string;
}

const tagNameReLeft = /<\/?[^<>\s\\\/\'\"\(\)\`\{\}\[\]]*$/;
const tagNameReRight = /^[^<>\s\\\/\'\"\(\)\`\{\}\[\]]*/;

let lastChangeByAutoRenameTag = { fsPath: '', version: -1 };
let wordsAtOffsets: Record<number, { oldWord: string; newWord: string }> = {};
let previousText: string | undefined;
let requestId = 0;
let changeListener: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push({ dispose: disposeListener });
  setPreviousText(vscode.window.activeTextEditor);
  setupListener();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!isEnabled(editor?.document)) {
        disposeListener();
        return;
      }
      setPreviousText(editor);
      setupListener();
    }),
  );
}

export function deactivate(): void {}

function isEnabled(document: vscode.TextDocument | undefined): boolean {
  if (!document) {
    return false;
  }
  if (document.languageId === 'html' || document.languageId === 'handlebars') {
    const editorSettings = vscode.workspace.getConfiguration('editor', document);
    if (editorSettings.get('renameOnType') || editorSettings.get('linkedEditing')) {
      return false;
    }
  }
  const languages = vscode.workspace
    .getConfiguration('auto-rename-tag', document.uri)
    .get<string[]>('activationOnLanguage', ['*']);
  return languages.includes('*') || languages.includes(document.languageId);
}

function setPreviousText(editor: vscode.TextEditor | undefined): void {
  previousText = editor?.document.getText();
}

function setupListener(): void {
  if (changeListener) {
    return;
  }
  changeListener = vscode.workspace.onDidChangeTextDocument(handleChange);
}

function disposeListener(): void {
  changeListener?.dispose();
  changeListener = undefined;
}

function handleChange(event: vscode.TextDocumentChangeEvent): void {
  const active = vscode.window.activeTextEditor;
  if (!active || event.document !== active.document) {
    return;
  }
  if (!isEnabled(event.document)) {
    disposeListener();
    return;
  }
  if (event.contentChanges.length === 0 || previousText === undefined) {
    return;
  }

  const tags: Tag[] = [];
  let totalInserted = 0;
  const sortedChanges = event.contentChanges.slice().sort((a, b) => a.rangeOffset - b.rangeOffset);
  const rememberedOffsets = Object.keys(wordsAtOffsets);
  for (const change of sortedChanges) {
    for (const key of rememberedOffsets) {
      const parsedKey = Number(key);
      if (change.rangeOffset <= parsedKey && parsedKey <= change.rangeOffset + change.rangeLength) {
        delete wordsAtOffsets[parsedKey];
      }
    }
    const line = event.document.lineAt(change.range.start.line);
    const lineStart = event.document.offsetAt(line.range.start);
    const lineChangeOffset = change.rangeOffset - lineStart;
    const lineLeft = line.text.slice(0, lineChangeOffset + totalInserted);
    const lineRight = line.text.slice(lineChangeOffset + totalInserted);
    const lineTagNameLeft = lineLeft.match(tagNameReLeft);
    const lineTagNameRight = lineRight.match(tagNameReRight);
    const previousTagNameRight = previousText.slice(change.rangeOffset).match(tagNameReRight);
    if (!lineTagNameLeft) {
      totalInserted += change.text.length - change.rangeLength;
      continue;
    }
    let newWord = lineTagNameLeft[0];
    let oldWord = lineTagNameLeft[0];
    if (lineTagNameRight?.[0]) {
      newWord += lineTagNameRight[0];
    }
    if (previousTagNameRight?.[0]) {
      oldWord += previousTagNameRight[0];
    }
    const offset = change.rangeOffset - lineTagNameLeft[0].length + totalInserted;
    tags.push({
      oldWord,
      word: newWord,
      offset,
      previousOffset: offset - totalInserted,
    });
    totalInserted += change.text.length - change.rangeLength;
  }

  updateWordsAtOffset(tags);
  previousText = event.document.getText();
  if (tags.length === 0) {
    return;
  }
  void renameTags(active, tags);
}

function updateWordsAtOffset(tags: Tag[]): void {
  const keys = Object.keys(wordsAtOffsets);
  if (keys.length > 0) {
    if (keys.length !== tags.length) {
      wordsAtOffsets = {};
    }
    for (const tag of tags) {
      if (!Object.hasOwn(wordsAtOffsets, tag.previousOffset)) {
        wordsAtOffsets = {};
        break;
      }
    }
  }
  for (const tag of tags) {
    const previous = wordsAtOffsets[tag.previousOffset];
    wordsAtOffsets[tag.offset] = {
      oldWord: previous?.oldWord || tag.oldWord,
      newWord: tag.word,
    };
    if (tag.previousOffset !== tag.offset) {
      delete wordsAtOffsets[tag.previousOffset];
    }
    tag.oldWord = wordsAtOffsets[tag.offset].oldWord;
  }
}

async function renameTags(editor: vscode.TextEditor, tags: Tag[]): Promise<void> {
  const beforeVersion = editor.document.version;
  const id = ++requestId;
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (id !== requestId) {
    return;
  }
  const active = vscode.window.activeTextEditor;
  if (!active || active.document !== editor.document) {
    return;
  }
  if (
    lastChangeByAutoRenameTag.fsPath === active.document.uri.fsPath &&
    lastChangeByAutoRenameTag.version === active.document.version
  ) {
    return;
  }

  const text = active.document.getText();
  const results: AppliedRename[] = [];
  for (const tag of tags) {
    const result = doAutoRenameTag(text, tag.offset, tag.word, tag.oldWord, active.document.languageId);
    if (!result) {
      continue;
    }
    results.push({
      ...result,
      originalOffset: tag.offset,
      originalWord: tag.word,
    });
  }
  if (id !== requestId) {
    return;
  }
  if (results.length === 0) {
    wordsAtOffsets = {};
    return;
  }
  if (active.document.version !== beforeVersion) {
    return;
  }
  await applyResults(active, results);
}

async function applyResults(editor: vscode.TextEditor, results: AppliedRename[]): Promise<void> {
  const document = editor.document;
  const prev = document.version;
  const applied = await editor.edit(
    (editBuilder) => {
      for (const result of results) {
        const start = document.positionAt(result.startOffset);
        const end = document.positionAt(result.endOffset);
        editBuilder.replace(new vscode.Range(start, end), result.tagName);
      }
    },
    { undoStopBefore: false, undoStopAfter: false },
  );
  if (!applied) {
    return;
  }
  const next = document.version;
  lastChangeByAutoRenameTag = {
    fsPath: document.uri.fsPath,
    version: document.version,
  };
  if (prev + 1 !== next) {
    return;
  }
  for (const result of results) {
    const remembered = wordsAtOffsets[result.originalOffset];
    delete wordsAtOffsets[result.originalOffset];
    const moved = result.originalWord.startsWith('</') ? result.endOffset - result.startOffset + 2 : 0;
    wordsAtOffsets[result.originalOffset + moved] = {
      newWord: remembered?.newWord ?? result.originalWord,
      oldWord: result.originalWord,
    };
  }
}
