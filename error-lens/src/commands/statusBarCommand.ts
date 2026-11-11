import { $config, $state } from '../extension';
import { Constants } from '../types';
import { vscodeUtils } from '../utils/vscodeUtils';
import { Selection, TextEditorRevealType, commands, env, window } from 'vscode';

export async function statusBarCommand(): Promise<void> {
	if ($config.statusBarCommand === 'goToLine' || $config.statusBarCommand === 'goToProblem') {
		const targetLocation = $state.statusBarMessage.activeMessageLocation;
		if (!targetLocation) {
			return;
		}
		const editor = vscodeUtils.getEditorByUri(targetLocation.uri);
		if (!editor) {
			return;
		}

		await window.showTextDocument(editor.document);
		editor.selection = new Selection(targetLocation.range.start, targetLocation.range.end);
		editor.revealRange(targetLocation.range, TextEditorRevealType.Default);
		await commands.executeCommand(Constants.FocusActiveEditorCommandId);

		if ($config.statusBarCommand === 'goToProblem') {
			commands.executeCommand(Constants.NextProblemCommandId);
		}
	} else if ($config.statusBarCommand === 'copyMessage') {
		const source = $state.statusBarMessage.activeMessageSource ? `[${$state.statusBarMessage.activeMessageSource}] ` : '';
		env.clipboard.writeText(source + $state.statusBarMessage.activeMessageText);
	}
}
