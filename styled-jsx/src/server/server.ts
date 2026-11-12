import {
  CodeAction,
  ColorInformation,
  ColorPresentation,
  CompletionList,
  createConnection,
  Definition,
  DidChangeConfigurationNotification,
  DocumentHighlight,
  Hover,
  InitializeParams,
  InitializeResult,
  ProposedFeatures,
  SymbolInformation,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionContext as CssCodeActionContext, getCSSLanguageService, LanguageSettings } from 'vscode-css-languageservice';
import { getLanguageModelCache } from './language-model-cache';
import { getStyledJsx, getStyledJsxUnderCursor, omitInterpolationDiagnostics, StyledJsx } from './styled-jsx';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const cssLanguageService = getCSSLanguageService();
const stylesheets = getLanguageModelCache(10, 60, (document) => cssLanguageService.parseStylesheet(document));

let hasConfigurationCapability = false;
let globalSettings: LanguageSettings = {};
const documentSettings = new Map<string, Promise<LanguageSettings>>();
const pendingValidation = new Map<string, ReturnType<typeof setTimeout>>();
const validationDelayMs = 200;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = Boolean(params.capabilities.workspace?.configuration);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false },
      hoverProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      codeActionProvider: true,
      colorProvider: true,
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
});

connection.onDidChangeConfiguration((change) => {
  globalSettings = readCssSettings(change.settings?.css);
  cssLanguageService.configure(globalSettings);
  documentSettings.clear();
  for (const document of documents.all()) {
    triggerValidation(document);
  }
});

documents.onDidChangeContent((change) => {
  triggerValidation(change.document);
});

documents.onDidClose((event) => {
  stylesheets.onDocumentRemoved(event.document);
  documentSettings.delete(event.document.uri);
  clearDiagnostics(event.document);
});

connection.onShutdown(() => {
  stylesheets.dispose();
});

connection.onCompletion((params): CompletionList | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  const styled = getStyledJsxUnderCursor(document, stylesheets, document.offsetAt(params.position));
  if (!styled) {
    return null;
  }
  return cssLanguageService.doComplete(styled.cssDocument, params.position, styled.stylesheet);
});

connection.onHover((params): Hover | null => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.doHover(styled.cssDocument, params.position, styled.stylesheet);
  });
});

connection.onDocumentSymbol((params): SymbolInformation[] | null => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.findDocumentSymbols(styled.cssDocument, styled.stylesheet);
  });
});

connection.onDefinition((params): Definition | null => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.findDefinition(styled.cssDocument, params.position, styled.stylesheet);
  });
});

connection.onDocumentHighlight((params): DocumentHighlight[] | null => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.findDocumentHighlights(styled.cssDocument, params.position, styled.stylesheet);
  });
});

connection.onReferences((params) => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.findReferences(styled.cssDocument, params.position, styled.stylesheet);
  });
});

connection.onCodeAction((params): CodeAction[] | null => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.doCodeActions2(styled.cssDocument, params.range, toCssCodeActionContext(params.context), styled.stylesheet);
  });
});

connection.onDocumentColor((params): ColorInformation[] => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.findDocumentColors(styled.cssDocument, styled.stylesheet);
  }) ?? [];
});

connection.onColorPresentation((params): ColorPresentation[] => {
  return withStyledJsx(params.textDocument.uri, (styled) => {
    return cssLanguageService.getColorPresentations(styled.cssDocument, styled.stylesheet, params.color, params.range);
  }) ?? [];
});

function withStyledJsx<T>(uri: string, run: (styled: StyledJsx) => T): T | null {
  const document = documents.get(uri);
  if (!document) {
    return null;
  }
  const styled = getStyledJsx(document, stylesheets);
  if (!styled) {
    return null;
  }
  return run(styled);
}

function triggerValidation(document: TextDocument): void {
  const pending = pendingValidation.get(document.uri);
  if (pending) {
    clearTimeout(pending);
  }
  pendingValidation.set(document.uri, setTimeout(() => {
    pendingValidation.delete(document.uri);
    void validateTextDocument(document);
  }, validationDelayMs));
}

async function validateTextDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);
  const styled = getStyledJsx(document, stylesheets);
  if (!styled) {
    clearDiagnostics(document);
    return;
  }
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: omitInterpolationDiagnostics(
      styled.cssDocument,
      cssLanguageService.doValidation(styled.cssDocument, styled.stylesheet, settings),
      styled.interpolations,
    ),
  });
}

function clearDiagnostics(document: TextDocument): void {
  const pending = pendingValidation.get(document.uri);
  if (pending) {
    clearTimeout(pending);
    pendingValidation.delete(document.uri);
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
}

function getDocumentSettings(resource: string): Promise<LanguageSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  const cached = documentSettings.get(resource);
  if (cached) {
    return cached;
  }
  const pending = connection.workspace.getConfiguration({
    scopeUri: resource,
    section: 'css',
  }).then(readCssSettings);
  documentSettings.set(resource, pending);
  return pending;
}

function readCssSettings(value: unknown): LanguageSettings {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as LanguageSettings;
  }
  return {};
}

function toCssCodeActionContext(context: { diagnostics: Array<{ message: string | { value: string } }>; only?: string[] }): CssCodeActionContext {
  return {
    diagnostics: context.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      message: typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
    })),
    only: context.only,
  } as CssCodeActionContext;
}

documents.listen(connection);
connection.listen();
