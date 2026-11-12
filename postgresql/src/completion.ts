import * as vscode from 'vscode';
import { pgKeywords } from './keywords';

const keywordItems = pgKeywords.map(
  (keyword) => new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword),
);

export class PostgresqlCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(): vscode.CompletionItem[] {
    return keywordItems;
  }
}
