import * as path from 'path';
import { ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

const documentSelector: LanguageClientOptions['documentSelector'] = [
  { language: 'javascript' },
  { language: 'javascriptreact' },
  { language: 'typescript' },
  { language: 'typescriptreact' },
];

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6004'] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {
      configurationSection: 'css',
    },
  };

  client = new LanguageClient('styledJsx', 'Styled JSX', serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
