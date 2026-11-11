import * as vscode from "vscode";
import { extensionMatches, fileExtension } from "../libs/utils";

export const closeType = async (uri: vscode.Uri | undefined, defaultTypes: boolean) => {
  try {
    const config = vscode.workspace.getConfiguration("closeTabs");
    let extensionsToClose: string[] = config.get("extensionsToClose", []);
    const caseSensitive: boolean = config.get("extensionsCaseSensitive", false);

    if (!defaultTypes && uri) {
      const clicked = fileExtension(uri.fsPath);
      if (clicked) {
        extensionsToClose = [clicked];
      }
    }

    vscode.window.tabGroups.all
      .flatMap((tabGroup) => tabGroup.tabs)
      .forEach((tab) => {
        if (tab.isPinned && !config.allowClosePinnedTabs) {
          return;
        }

        const fileName = tabPath(tab);
        if (!fileName) {
          return;
        }

        if (extensionMatches(fileName, extensionsToClose, caseSensitive)) {
          vscode.window.tabGroups.close(tab, true);
        }
      });
  } catch {
    vscode.window.showErrorMessage("Unexpected error while closing the tabs!");
  }
};

function tabPath(tab: vscode.Tab): string | undefined {
  if (tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) {
    return tab.input.uri.fsPath;
  }
  return undefined;
}
