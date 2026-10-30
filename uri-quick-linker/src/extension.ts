// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

class NoTextEditorOpen extends Error {
}

class DocumentIsUntitled extends Error {
}


export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.copyUriAndLineNumber', () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      throw new NoTextEditorOpen;
    }
  
    let document = editor.document;
    if (document.isUntitled) {
      throw new DocumentIsUntitled;
    }

    if (editor) {
      const uriAndLine = copyCurrentFilePathWithCurrentLineNumber(false, false, editor, document);
      vscode.env.clipboard.writeText(uriAndLine)
    }
  });


  let pasteDisposable = vscode.commands.registerCommand('extension.pasteUri', async () => {
    const editor = vscode.window.activeTextEditor;
  
    if (!editor) {
      return; // Exit if no editor is open
    }
  
    let document = editor.document;
    if (document.isUntitled) {
      return; // Exit if document is untitled
    }
  
    // Call pasteURI and use its output
    const pasteUri = await pasteURI(editor);
    editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, pasteUri);
    });
  });

  const handleLinkClickCommand = vscode.commands.registerCommand('extension.handleLinkClick', uri => {
    vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uri));
  });
  

  let formatLinks = vscode.commands.registerCommand('extension.formatUriAsLink', async () => {
    resetDecorations();
    updateDecorations(vscode.window.activeTextEditor!)
  });



  // get the config for the link color and icon
  const config = vscode.workspace.getConfiguration('uriQuickLinker');
  const linkColor = config.get('linkColor');
  const showLinkIcon = config.get('showLinkIcon');

  // set the link color
  const linkDecorator = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline', // Underline to indicate a link
    cursor: 'pointer', // Cursor style as a pointer
    color: linkColor ?? '#0000FF', // Default link color
  });

  function rangeKey(range: vscode.Range) {
    // Generates a unique key for a range object
    return `Range(${range.start.line},${range.start.character},${range.end.line},${range.end.character})`;
  }

  const existingDecorations = new Map();

  function updateDecorations(editor: vscode.TextEditor) {
    if (!editor) {
      vscode.window.showInformationMessage('No active editor available for decoration.');
      return;
    }

    const document = editor.document;
    const text = document.getText();
    const linkPattern = /URI:\s*(https?:\/\/[^\s]+|vscode:\/\/file\/[^\s]+)/g;
    const linkDecorations: vscode.DecorationOptions[] = [];

    let match;
    while ((match = linkPattern.exec(text)) !== null) {

      const uri = match[1];
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      const key = rangeKey(range);

      if (existingDecorations.has(key)) {
        // console.log('Decoration already exists for range: ', key);
        continue; // Skip this loop iteration if decoration already exists
      } else {
        // console.log('Decoration does not exist for range: ', key);
      }

      const messageMarkdown = new vscode.MarkdownString(`[Open File: ${uri}](command:extension.handleLinkClick?${encodeURIComponent(JSON.stringify(uri))})`);
      messageMarkdown.supportHtml = true;
      messageMarkdown.isTrusted = true;

      const decoration = {
        range: range,
        hoverMessage: messageMarkdown,
        renderOptions: { 
          after: {
            contentText: showLinkIcon ? '🔗' : '',
          }
        },
        command: 'extension.handleLinkClick',
        arguments: [uri]
      };

      existingDecorations.set(key, true);
      linkDecorations.push(decoration);
    }
    if (linkDecorations.length > 0) editor.setDecorations(linkDecorator, linkDecorations);
  }


  // Reset stored decorations if necessary, e.g., on document close or window change
  function resetDecorations() {
    existingDecorations.clear();
  }

  // Initial update if an editor is active
  if (vscode.window.activeTextEditor) {
    resetDecorations();
    updateDecorations(vscode.window.activeTextEditor);
  }

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      resetDecorations();
      updateDecorations(editor);
    }
  }, null, context.subscriptions);
  
  vscode.workspace.onDidChangeTextDocument(event => {
    if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
      resetDecorations();
      updateDecorations(vscode.window.activeTextEditor);
    }
  }, null, context.subscriptions);


  context.subscriptions.push(disposable, pasteDisposable, formatLinks, handleLinkClickCommand);
}

export function deactivate() {
}


function copyCurrentFilePathWithCurrentLineNumber(markdown: boolean = false, includeHighlightedTextAsCodeBlock: boolean = false, editor: vscode.TextEditor, document: vscode.TextDocument): string {
	const path = document.uri.path;
	const relativePath = vscode.workspace?.rootPath
		? path.replace(vscode.workspace?.rootPath, "")
		: path;
	const lineNumber = editor.selection.active.line + 1;
	const columnNumber = editor.selection.active.character + 1;
	const config = vscode.workspace.getConfiguration('uriQuickLinker');
	const includeColumn = config.get('includeColumn');
	const useVSCodeInsiders = config.get('useVSCodeInsiders');
	const protocol = useVSCodeInsiders ? 'vscode-insiders' : 'vscode';

	const url = `${protocol}://file${path}:${lineNumber}${includeColumn ? `:${columnNumber}` : ''}`;
	let output = markdown ? `[${relativePath}:${lineNumber}${includeColumn ? `:${columnNumber}` : ''}](${url})` : url;

	const selectedText = editor.document.getText(editor.selection);
  
	if (includeHighlightedTextAsCodeBlock && selectedText.length) {
		const codeBlock = "```" + document.languageId + "\n" + selectedText + "\n```";
		output += "\n" + codeBlock;
	}

	return output;
};


async function pasteURI(editor: vscode.TextEditor): Promise<string> {
  const config = vscode.workspace.getConfiguration('uriQuickLinker');
  const fileTypes = config.get<{ [key: string]: { prefix: string; suffix: string } }>('fileTypes');


  if (!fileTypes) {
    vscode.window.showErrorMessage('No file types configured');
    return '';
  }
  
  const document = editor.document;
  const fileType = document.languageId;

  // If the fileType of the current document is not configured, show an error message
  if (!fileTypes[document.languageId]) {
    vscode.window.showErrorMessage('File type for this document is not configured: ' + document.languageId);
    return '';
  }

  const uri = await vscode.env.clipboard.readText();

  // vscode.window.showInformationMessage('Doc Type: ' +   document.languageId)

  // Retrieve the prefix and suffix from the configuration
  const { prefix, suffix } = fileTypes[fileType] || { prefix: '', suffix: '' };

  // Format the URI using the configured prefix and suffix
  return `${prefix} URI: ${uri} ${suffix}`;

}


