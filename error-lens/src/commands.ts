import { codeLensOnClickCommand } from './commands/codeLensOnClickCommand';
import { copyProblemCodeCommand } from './commands/copyProblemCodeCommand';
import { copyProblemMessageCommand } from './commands/copyProblemMessageCommand';
import { disableLineCommand } from './commands/disableLineCommand';
import { excludeProblemCommand } from './commands/excludeProblemCommand';
import { findLinterRuleDefinitionCommand } from './commands/findLinterRuleDefinitionCommand';
import { nextProblemCommand, prevProblemCommand } from './commands/gotoProblemCommand';
import { revealLineCommand } from './commands/revealLineCommand';
import { searchForProblemCommand } from './commands/searchForProblemCommand';
import { selectProblemCommand } from './commands/selectProblemCommand';
import { statusBarCommand } from './commands/statusBarCommand';
import { toggleEnabledLevels } from './commands/toggleEnabledLevels';
import { toggleWorkspaceCommand } from './commands/toggleWorkspaceCommand';
import { updateEverythingCommand } from './commands/updateEverythingCommand';
import { $config } from './extension';
import { vscodeUtils } from './utils/vscodeUtils';
import { commands, type ExtensionContext } from 'vscode';

/**
 * All command ids contributed by this extensions.
 */
export const enum CommandId {
	// ──── User facing ───────────────────────────────────────────
	Toggle = 'errorLens.toggle',
	ToggleError = 'errorLens.toggleError',
	ToggleWarning = 'errorLens.toggleWarning',
	ToggleInfo = 'errorLens.toggleInfo',
	ToggleHint = 'errorLens.toggleHint',
	ToggleInlineMessage = 'errorLens.toggleInlineMessage',
	/** {@link toggleWorkspaceCommand} */
	ToggleWorkspace = 'errorlens.toggleWorkspace',
	/** {@link copyProblemMessageCommand} */
	CopyProblemMessage = 'errorLens.copyProblemMessage',
	/** {@link copyProblemCodeCommand} */
	CopyProblemCode = 'errorLens.copyProblemCode',
	/** {@link selectProblemCommand} */
	SelectProblem = 'errorLens.selectProblem',
	/** {@link nextProblemCommand} */
	NextProblem = 'errorLens.nextProblem',
	/** {@link prevProblemCommand} */
	PrevProblem = 'errorLens.prevProblem',
	/** {@link findLinterRuleDefinitionCommand} */
	FindLinterRuleDefinition = 'errorLens.findLinterRuleDefinition',
	/** {@link searchForProblemCommand} */
	SearchForProblem = 'errorLens.searchForProblem',
	/** {@link disableLineCommand} */
	DisableLine = 'errorLens.disableLine',
	/** {@link updateEverythingCommand} */
	UpdateEverything = 'errorLens.updateEverything',
	// ──── Internal ──────────────────────────────────────────────
	/** {@link statusBarCommand} */
	StatusBarCommand = 'errorLens.statusBarCommand',
	/** {@link revealLineCommand} */
	RevealLine = 'errorLens.revealLine',
	/** {@link excludeProblemCommand} */
	ExcludeProblem = 'errorLens.excludeProblem',
	/** {@link codeLensOnClickCommand} */
	CodeLensOnClick = 'errorLens.codeLensOnClick',
}

/**
 * Register all commands contributed by this extension.
 */
export function registerAllCommands(context: ExtensionContext): void {
	// ────────────────────────────────────────────────────────────
	// ──── Global commands ───────────────────────────────────────
	// ────────────────────────────────────────────────────────────
	context.subscriptions.push(commands.registerCommand(CommandId.Toggle, () => {
		vscodeUtils.updateGlobalSetting('errorLens.enabled', !$config.enabled);
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleError, () => {
		toggleEnabledLevels('error', $config.enabledDiagnosticLevels);
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleWarning, () => {
		toggleEnabledLevels('warning', $config.enabledDiagnosticLevels);
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleInfo, () => {
		toggleEnabledLevels('info', $config.enabledDiagnosticLevels);
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleHint, () => {
		toggleEnabledLevels('hint', $config.enabledDiagnosticLevels);
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleInlineMessage, () => {
		vscodeUtils.toggleGlobalBooleanSetting('errorLens.messageEnabled');
	}));
	context.subscriptions.push(commands.registerCommand(CommandId.ToggleWorkspace, toggleWorkspaceCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.UpdateEverything, updateEverythingCommand));

	context.subscriptions.push(commands.registerCommand(CommandId.FindLinterRuleDefinition, findLinterRuleDefinitionCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.SearchForProblem, searchForProblemCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.CopyProblemCode, copyProblemCodeCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.DisableLine, disableLineCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.CopyProblemMessage, copyProblemMessageCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.ExcludeProblem, excludeProblemCommand));
	// ────────────────────────────────────────────────────────────
	// ──── Text Editor commands ──────────────────────────────────
	// ────────────────────────────────────────────────────────────
	context.subscriptions.push(commands.registerTextEditorCommand(CommandId.SelectProblem, selectProblemCommand));
	context.subscriptions.push(commands.registerTextEditorCommand(CommandId.NextProblem, nextProblemCommand));
	context.subscriptions.push(commands.registerTextEditorCommand(CommandId.PrevProblem, prevProblemCommand));
	// ────────────────────────────────────────────────────────────
	// ──── Internal commands ─────────────────────────────────────
	// ────────────────────────────────────────────────────────────
	context.subscriptions.push(commands.registerCommand(CommandId.CodeLensOnClick, codeLensOnClickCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.RevealLine, revealLineCommand));
	context.subscriptions.push(commands.registerCommand(CommandId.StatusBarCommand, statusBarCommand));
}
