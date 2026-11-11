import { $config } from '../extension';
import { extUtils } from '../utils/extUtils';
import { Uri, env, window, type Diagnostic } from 'vscode';

/**
 * When arg = undefined => it was called from Command Palette.
 */
export function searchForProblemCommand(diagnostic: Diagnostic | undefined): void {
	if (!diagnostic) {
		const editor = window.activeTextEditor;
		if (!editor) {
			return;
		}

		const diagnosticAtActiveLine = extUtils.getDiagnosticAtLine(editor.document.uri, editor.selection.active.line);
		if (!diagnosticAtActiveLine) {
			return;
		}
		diagnostic = diagnosticAtActiveLine;
	}

	const query = extUtils.diagnosticToInlineMessage($config.searchForProblemQuery, diagnostic, 0);
	env.openExternal(Uri.parse(query));
}
