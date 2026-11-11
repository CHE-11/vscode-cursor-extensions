import * as vscode from "vscode";
import { closeLeft } from "./commands/closeLeft";
import { closeType } from "./commands/closeType";
import { closeUnchanged } from "./commands/closeUnchanged";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("close-tabs.git-unchanged", closeUnchanged),
    vscode.commands.registerCommand("close-tabs.close-left", closeLeft),
    vscode.commands.registerCommand("close-tabs.closeAllOfType", (uri: vscode.Uri) => closeType(uri, false)),
    vscode.commands.registerCommand("close-tabs.closeDefaultTypes", (uri: vscode.Uri) => closeType(uri, true))
  );
}
