import * as vscode from 'vscode';
import * as path from 'path';
import { Count } from './LineCounter';
import { LanguageConf, LineCounterTable } from './LineCounterTable';
import Gitignore from './Gitignore';
import { buildUri, compileTemplate, createTextDecoder, currentWorkspaceFolder, dirUri, readJsonFile, readUtf8Files, writeTextFile } from './vscode-utils';
import { internalDefinitions } from './internalDefinitions';
import { countWords } from './WordCounter';
import { CodeCounterView, type CountCommand } from './sidebar';
import { fileMatchesTypes, searchInclude, toBraceGlob } from './walk';

const EXTENSION_ID = 'che-11.ce-code-counter';
const EXTENSION_NAME = 'Code Counter';
const CONFIGURATION_SECTION = 'code-counter';
const toZeroPadString = (num: number, fig: number) => num.toString().padStart(fig, '0');
const toLocalDateString = (date: Date, delims: [string, string, string] = ['-', ' ', ':']) => {
    return `${date.getFullYear()}${delims[0]}${toZeroPadString(date.getMonth() + 1, 2)}${delims[0]}${toZeroPadString(date.getDate(), 2)}${delims[1]}`
        + `${toZeroPadString(date.getHours(), 2)}${delims[2]}${toZeroPadString(date.getMinutes(), 2)}${delims[2]}${toZeroPadString(date.getSeconds(), 2)}`;
};
const toStringWithCommas = (obj: any) => {
    if (typeof obj === 'number') {
        return new Intl.NumberFormat('en-US').format(obj);
    } else {
        return obj.toString();
    }
};
const log = (message: string, ...items: any[]) => console.log(`${new Date().toISOString()} ${message}`, ...items);
const showError = (message: string) => {
    void vscode.window.showErrorMessage(`[${EXTENSION_NAME}] ${message}`);
};
const registerCommand = (command: string, callback: (...args: any[]) => Promise<any>): vscode.Disposable => {
    return vscode.commands.registerCommand(`code-counter.${command}`, async (...args) => {
        try {
            await callback(...args);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            showError(`"${command}" failed. ${message}`);
        }
    });
};

export const activate = (context: vscode.ExtensionContext) => {
    const version = context.extension.packageJSON.version as string;
    log(`${EXTENSION_ID} ${version} active`);
    const codeCountController = new CodeCounterController();
    const sidebar = new CodeCounterView(() => codeCountController.realtimeVisible());
    context.subscriptions.push(
        codeCountController,
        sidebar,
        vscode.window.registerTreeDataProvider('code-counter.sidebar', sidebar),
        codeCountController.onDidChangeRealtime(() => sidebar.refresh()),
        codeCountController.onDidChangeCounting((command) => sidebar.setCounting(command)),
        registerCommand('countInWorkspace', () => codeCountController.countLinesInWorkSpace()),
        registerCommand('countInDirectory', (targetDir: vscode.Uri | undefined) => codeCountController.countLinesInDirectory(targetDir)),
        registerCommand('toggleRealtime', () => codeCountController.toggleVisibleRealtimeCounter()),
        registerCommand('saveLanguageConfigurations', () => codeCountController.saveLanguageConfigurations()),
        registerCommand('outputAvailableLanguages', () => codeCountController.outputAvailableLanguages()),
        registerCommand('addWalkEntry', (node?: unknown) => sidebar.addWalkEntry(node)),
        registerCommand('editWalkEntry', (node?: unknown) => sidebar.editWalkEntry(node)),
        registerCommand('deleteWalkEntry', (node?: unknown) => sidebar.deleteWalkEntry(node)),
        registerCommand('toggleWalkOption', (node?: unknown) => sidebar.toggleWalkOption(node)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIGURATION_SECTION)) sidebar.refresh();
        }),
    );
};
export const deactivate = () => { };

type LanguageLocation = 'global' | 'workspace' | 'output' | 'file';

const loadConfig = () => {
    const conf = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    const confFiles = vscode.workspace.getConfiguration('files', null);

    const include = conf.get<string[]>('include', ['**/*']);
    const exclude = conf.get<string[]>('exclude', []);
    const fileTypes = conf.get<string[]>('fileTypes', []);
    if (conf.get('useFilesExclude', true)) {
        exclude.push(...Object.keys(confFiles.get<object>('exclude', {})));
    }
    return {
        configuration: conf,
        saveLocation: conf.get<string>('saveLocation', 'global') as LanguageLocation,
        outputDirectory: conf.get('outputDirectory', '.code-counter'),
        languageConfUri: conf.get('languageConfUri', ''),
        include,
        exclude,
        fileTypes,
        useGitignore: conf.get('useGitignore', true),

        encoding: confFiles.get('encoding', 'utf8'),
        associations: Object.entries(confFiles.get<{ [key: string]: string }>('associations', {})),

        maxOpenFiles: conf.get('maxOpenFiles', 500),
        maxFindFiles: conf.get('maxFindFiles', 1_000_000),
        ignoreUnsupportedFile: conf.get('ignoreUnsupportedFile', true),
        languages: conf.get<{ [key: string]: Partial<LanguageConf> }>('languages', {}),

        includeIncompleteLine: conf.get('includeIncompleteLine', true),
        endOfLine: conf.get('endOfLine', '\n'),
        printNumberWithCommas: conf.get('printNumberWithCommas', true),
        countDirectLevelFiles: conf.get('countDirectLevelFiles', true),
    };
};
type Config = ReturnType<typeof loadConfig>;

const pathBasedName = (uri: vscode.Uri) => {
    const path = (uri.scheme === 'file') ? uri.fsPath : uri.toString();
    return path.replace(/[:\/\\?#\[\]\@]+/g, '-');
};
class CodeCounterController {
    private codeCounter_: LineCounterTable | null = null;
    private readonly realtimeChanged = new vscode.EventEmitter<void>();
    readonly onDidChangeRealtime = this.realtimeChanged.event;
    private counting: CountCommand | undefined;
    private readonly countingChanged = new vscode.EventEmitter<CountCommand | undefined>();
    readonly onDidChangeCounting = this.countingChanged.event;
    private statusBarItem: vscode.StatusBarItem | null = null;
    private outputChannel: vscode.OutputChannel | null = null;
    private disposable: vscode.Disposable;
    private conf: Config;
    private async getWorkDirs() {
        const workDir = await currentWorkspaceFolder();
        const v = {
            workspaceName: workDir.name,
            workspacePath: pathBasedName(workDir.uri),
            workspaceIndex: workDir.index.toString(),
        };
        const dir = compileTemplate(this.conf.outputDirectory, v);
        const outputDir = buildUri(workDir.uri, dir);
        log(`OutDir: "${this.conf.outputDirectory}"->"${dir}"`, v);
        return { workDir, outputDir };
    }
    private async getLanguageConfUri() {
        const { workDir, outputDir } = await this.getWorkDirs();
        switch (this.conf.saveLocation) {
            case 'output':
                return vscode.Uri.joinPath(outputDir, 'languages.json');
            case 'file':
                return buildUri(workDir.uri, this.conf.languageConfUri);
            case 'global':
            case 'workspace':
            default: break;
        }
        return undefined;
    }
    private async getRealtimeCounterStateFileUri() {
        const { outputDir } = await this.getWorkDirs();
        return vscode.Uri.joinPath(outputDir, '.code-counter-realtime');
    }

    constructor() {
        const subscriptions: vscode.Disposable[] = [];
        vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, subscriptions);
        vscode.window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection, this, subscriptions);
        vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this, subscriptions);
        vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, subscriptions);
        this.conf = loadConfig();

        this.disposable = vscode.Disposable.from(...subscriptions);

        this.getRealtimeCounterStateFileUri()
            .then((uri) => vscode.workspace.fs.stat(uri))
            .then(() => this.toggleVisibleRealtimeCounter())
            .catch(() => undefined);
    }
    realtimeVisible(): boolean {
        return this.statusBarItem !== null;
    }
    dispose() {
        this.statusBarItem?.dispose();
        this.statusBarItem = null;
        this.outputChannel?.dispose();
        this.outputChannel = null;
        this.realtimeChanged.dispose();
        this.countingChanged.dispose();
        this.disposable.dispose();
        this.codeCounter_ = null;
    }
    private onDidChangeActiveTextEditor(e: vscode.TextEditor | undefined) {
        // log(`onDidChangeActiveTextEditor(${e?.document.uri})`);
        this.countLinesInEditor(e);
    }
    private onDidChangeTextEditorSelection(e: vscode.TextEditorSelectionChangeEvent) {
        // log(`onDidChangeTextEditorSelection(${e.selections.length}selections, ${e.selections[0].isEmpty} )`, e.selections[0]);
        this.countLinesInEditor(e.textEditor);
    }
    private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
        // log(`onDidChangeTextDocument(${e.document.uri})`);
        this.countLinesOfFile(e.document);
    }
    private onDidChangeConfiguration() {
        // log(`onDidChangeConfiguration()`);
        this.codeCounter_ = null;
        this.conf = loadConfig();
        this.countLinesInEditor(vscode.window.activeTextEditor);
    }
    public async toggleVisibleRealtimeCounter() {
        const uri = await this.getRealtimeCounterStateFileUri();
        try {
            if (!this.statusBarItem) {
                this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100000);
                this.countLinesInEditor(vscode.window.activeTextEditor);
                await writeTextFile(uri, '', { recursive: true });
            } else {
                this.statusBarItem.dispose();
                this.statusBarItem = null;
                await vscode.workspace.fs.delete(uri);
            }
        } finally {
            this.realtimeChanged.fire();
        }
    }

    private async getCodeCounter() {
        if (this.codeCounter_) {
            return this.codeCounter_;
        }
        const langs = new Map<string, LanguageConf>();
        appendAll(langs, internalDefinitions);
        appendAll(langs, await this.loadLanguageConfigurations());

        log(`load Language Settings = ${langs.size}`);
        await collectLanguageConfigurations(langs);
        log(`collect Language Settings = ${langs.size}`);
        this.codeCounter_ = new LineCounterTable(langs, this.conf.associations);
        return this.codeCounter_;
    }
    public async loadLanguageConfigurations(): Promise<{ [key: string]: Partial<LanguageConf> }> {
        try {
            switch (this.conf.saveLocation) {
                case 'global':
                case 'workspace':
                    return this.conf.languages;
                default:
                    const uri = await this.getLanguageConfUri();
                    log(`Language Settings File: ${uri}`);
                    if (uri) {return await readJsonFile<{ [key: string]: Partial<LanguageConf> }>(uri, {});}
            }
        } catch (e: any) {
            showError(`loadLanguageConfigurations failed. ${e.message}`);
        }
        return {};
    }

    public async saveLanguageConfigurations() {
        const c = await this.getCodeCounter();
        const langs = mapToObject(c.entries());
        switch (this.conf.saveLocation) {
            case 'global':
                return this.conf.configuration.update('languages', langs, vscode.ConfigurationTarget.Global);
            case 'workspace':
                return this.conf.configuration.update('languages', langs, vscode.ConfigurationTarget.Workspace);
            default:
                const uri = await this.getLanguageConfUri();
                log(`Language Settings File: ${uri}`);
                if (uri) {return writeTextFile(uri, JSON.stringify(langs), { recursive: true });}
        }
    }

    public async outputAvailableLanguages() {
        const c = await this.getCodeCounter();
        c.entries().forEach((lang, id) => {
            this.toOutputChannel(`${id} : aliases[${lang.aliases}], extensions[${lang.extensions}], filenames:[${lang.filenames}]`);
        });
        this.toOutputChannel(`${EXTENSION_NAME}: ${c.entries().size} languages.`);
    }

    public async countLinesInDirectory(targetDir: vscode.Uri | undefined) {
        const { workDir, outputDir } = await this.getWorkDirs();
        if (targetDir) {
            await this.countLinesInDirectory_(targetDir, outputDir, 'countInDirectory');
        } else {
            const option = {
                value: workDir.uri.toString(true),
                placeHolder: 'Input Directory Path',
                prompt: 'Input Directory Path. '
            };
            const uri = await vscode.window.showInputBox(option);
            if (uri) {
                await this.countLinesInDirectory_(vscode.Uri.parse(uri), outputDir, 'countInDirectory');
            }
        }
    }
    public async countLinesInWorkSpace() {
        const { workDir, outputDir } = await this.getWorkDirs();
        await this.countLinesInDirectory_(workDir.uri, outputDir, 'countInWorkspace');
    }
    private setCounting(command: CountCommand | undefined) {
        this.counting = command;
        this.countingChanged.fire(command);
    }
    private async countLinesInDirectory_(targetUri: vscode.Uri, outputDir: vscode.Uri, source: CountCommand) {
        if (this.counting) return;
        this.setCounting(source);
        const date = new Date();
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        try {
            statusBar.show();
            statusBar.text = 'Code Counter: Preparing...';

            const includeGlob = searchInclude(this.conf.include, this.conf.fileTypes);
            const excludePatterns = [...this.conf.exclude, vscode.workspace.asRelativePath(outputDir)]
                .map(pattern => pattern.trim())
                .filter(Boolean);
            const excludeGlob = excludePatterns.length === 0 ? null : toBraceGlob(excludePatterns);
            log(`include : "${includeGlob}"`);
            log(`exclude : "${excludeGlob ?? ''}"`);
            log(`file types : ${this.conf.fileTypes.join(', ') || '(all)'}`);
            const files = await vscode.workspace.findFiles(includeGlob, excludeGlob, this.conf.maxFindFiles);
            let targetFiles = files.filter(uri => !path.relative(targetUri.path, uri.path).startsWith('..'));
            targetFiles = targetFiles.filter(uri => fileMatchesTypes(uri.fsPath, this.conf.fileTypes));
            if (this.conf.useGitignore) {
                log(`target : ${targetFiles.length} files -> use .gitignore`);
                const gitignores = await loadGitIgnore(this.conf.maxFindFiles);
                targetFiles = targetFiles.filter(p => gitignores.excludes(p.fsPath));
            }

            const counter = await this.getCodeCounter();
            const results = await countLines(counter, targetFiles, {
                maxOpenFiles: this.conf.maxOpenFiles,
                fileEncoding: this.conf.encoding,
                ignoreUnsupportedFile: this.conf.ignoreUnsupportedFile,
                includeIncompleteLine: this.conf.includeIncompleteLine,
                showStatus: (msg: string) => statusBar.text = `Code Counter: ${msg}`
            });
            if (results.length <= 0) {
                throw Error('There was no target file.');
            }
            statusBar.text = 'Code Counter: Totaling...';
            await showResults(date, targetUri, results, this.conf);
        } finally {
            log(`finished. ${(new Date().getTime() - date.getTime())}ms`);
            this.setCounting(undefined);
            statusBar.dispose();
        }
    }
    private async countLinesInEditor(editor: vscode.TextEditor | undefined) {
        return this.countLinesOfFile(editor?.document, editor?.selections);
    }
    private async countLinesOfFile(doc: vscode.TextDocument | undefined, selections?: readonly vscode.Selection[]) {
        const c = await this.getCodeCounter();
        const lineCounter = doc ? c.getCounter(doc.uri.fsPath, doc.languageId) : undefined;
        if (!this.statusBarItem) {return;}
        const texts: string[] = [];
        const addText = (c: number|undefined, unit: string) => {
            if (c !== undefined) {
                texts.push(`${c}${unit}${c === 1 ? '' : 's'}`);
            }
        };
        if (doc) {
            if (!selections || selections.length <= 0 || selections[0].isEmpty) {
                const docText = doc.getText();
                const words = countWords(docText, vscode.env.language);
                const result = lineCounter?.count(docText, this.conf.includeIncompleteLine);
                addText(result?.code, 'code');
                addText(result?.comment, 'comment');
                addText(result?.blank, 'blank');
                addText(words, 'word');
                addText(docText.length, 'char');
            } else {
                const docTexts = selections.map(s => doc.getText(s));
                const words = docTexts.map(d => countWords(d, vscode.env.language)).reduce((v, s) => v + s);
                const result = !lineCounter ? undefined : docTexts.map(d => lineCounter.count(d, true))
                    .reduce((prev, cur) => prev.add(cur), new Count());
                texts.push('Selected');
                addText(result?.code, 'code');
                addText(result?.comment, 'comment');
                addText(result?.blank, 'blank');
                addText(words, 'word');
                addText(docTexts.reduce((s, d) => s + d.length, 0), 'char');
            }
        }
        this.statusBarItem.show();
        // this.statusBarItem.text = text || `${EXTENSION_NAME}: Unsupported`;
        this.statusBarItem.text = `$(pencil)${texts.join(' ') || 'Unsupported'}`;
    }

    private toOutputChannel(text: string) {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
        }
        this.outputChannel.show();
        this.outputChannel.appendLine(text);
    }
}


const loadGitIgnore = async (maxFindFiles?: number) => {
    const gitignoreFiles = await vscode.workspace.findFiles('**/.gitignore', '', maxFindFiles);
    gitignoreFiles.forEach(f => log(`use gitignore : ${f}`));
    const values = await readUtf8Files(gitignoreFiles.sort());
    return new Gitignore('').merge(...values.map(p => new Gitignore(p.data, dirUri(p.uri).fsPath)));
};
type CountLineOption = {
    maxOpenFiles: number;
    fileEncoding: string;
    ignoreUnsupportedFile?: boolean;
    includeIncompleteLine?: boolean;
    showStatus?: (text: string) => void;
};
const countLines = async (lineCounterTable: LineCounterTable, fileUris: vscode.Uri[], option: CountLineOption): Promise<Result[]> => {
    log(`countLines : target ${fileUris.length} files`);
    const results = new Array<Result | undefined>(fileUris.length);
    const decoder = createTextDecoder(option.fileEncoding);
    let next = 0;
    let finished = 0;
    const total = fileUris.length;

    const readOne = async () => {
        while (next < total) {
            const index = next++;
            const fileUri = fileUris[index];
            const lineCounter = lineCounterTable.getCounter(fileUri.fsPath);
            if (!lineCounter) {
                if (!option.ignoreUnsupportedFile) {
                    results[index] = new Result(fileUri, '(Unsupported)');
                }
            } else {
                try {
                    const data = await vscode.workspace.fs.readFile(fileUri);
                    results[index] = new Result(fileUri, lineCounter.name, lineCounter.count(decoder.decode(data), option.includeIncompleteLine));
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    log(`"${fileUri}" Read Error : ${message}.`);
                    results[index] = new Result(fileUri, '(Read Error)');
                }
            }
            finished++;
            option.showStatus?.(`${finished}/${total}`);
        }
    };

    if (total > 0) {
        const workers = Math.min(Math.max(option.maxOpenFiles, 1), total);
        await Promise.all(Array.from({ length: workers }, () => readOne()));
    }
    const counted = results.filter((result): result is Result => result !== undefined);
    log(`count finished : total:${total} valid:${counted.length}`);
    return counted;
};

type VscodeLanguage = {
    id: string;
    aliases?: string[];
    filenames?: string[];
    extensions?: string[];
    configuration?: string;
};
type VscodeLanguageConfiguration = Omit<vscode.LanguageConfiguration, 'autoClosingPairs'> & {
    autoClosingPairs?: ({
        open?: string;
        close?: string;
        notIn?: string[];
    } | vscode.CharacterPair)[];
};

const append = (langs: Map<string, LanguageConf>, id: string, value: Partial<LanguageConf>) => {
    const langExt = getOrSet(langs, id, (): LanguageConf => {
        return {
            aliases: [],
            filenames: [],
            extensions: [],
            lineComments: [],
            blockComments: [],
            blockStrings: [],
            lineStrings: [],
        };
    });
    langExt.aliases.push(...(value.aliases ?? []));
    langExt.filenames.push(...(value.filenames ?? []));
    langExt.extensions.push(...(value.extensions ?? []));
    langExt.lineComments.push(...(value.lineComments ?? []));
    langExt.blockComments.push(...(value.blockComments ?? []));
    langExt.blockStrings.push(...(value.blockStrings ?? []));
    langExt.lineStrings.push(...(value.lineStrings ?? []));
    langExt.blockStringAsComment = langExt.blockStringAsComment || value.blockStringAsComment;
    return langExt;
};
const appendAll = (langs: Map<string, LanguageConf>, defs: { [id: string]: Partial<LanguageConf> }) => {
    Object.entries(defs).forEach(v => append(langs, v[0], v[1]));
};

const collectLanguageConfigurations = async (langs: Map<string, LanguageConf>): Promise<Map<string, LanguageConf>> => {
    for (const extension of vscode.extensions.all) {
        const languages = extension.packageJSON.contributes?.languages as VscodeLanguage[] | undefined;
        if (!languages) continue;
        for (const language of languages) {
            try {
                const langExt = append(langs, language.id, language);
                if (!language.configuration) continue;
                const confUrl = vscode.Uri.file(path.join(extension.extensionPath, language.configuration));
                const langConf = await readJsonFile<VscodeLanguageConfiguration>(confUrl, {});
                if (langConf.comments?.lineComment) {
                    langExt.lineComments.push(langConf.comments.lineComment);
                }
                if (langConf.comments?.blockComment && langConf.comments.blockComment.length >= 2) {
                    langExt.blockComments.push(langConf.comments.blockComment);
                }
                if (langConf.autoClosingPairs) {
                    const maybeString = langConf.autoClosingPairs
                        .map(pair => Array.isArray(pair) ? pair : [pair.open, pair.close])
                        .filter((pair): pair is [string, string] => !!pair && typeof pair[0] === 'string' && typeof pair[1] === 'string' && !'[{('.includes(pair[0]));
                    langExt.lineStrings.push(...maybeString);
                }
            } catch (reason: unknown) {
                log(`error ${reason}`);
            }
        }
    }
    return langs;
};


const showResults = async (date: Date, targetDirUri: vscode.Uri, results: Result[], conf: Config) => {
    const text = new ResultFormatter(targetDirUri, results, conf).toDocument(date);
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: text });
    await vscode.window.showTextDocument(doc, { preview: true });
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
};

class Result extends Count {
    public uri: vscode.Uri;
    public filename: string;
    public language: string;

    constructor(uri: vscode.Uri, language: string, count = { code: 0, comment: 0, blank: 0 }) {
        super(count.code, count.comment, count.blank);
        this.uri = uri;
        this.filename = uri.fsPath;
        this.language = language;
    }
}
class Statistics extends Count {
    public name: string;
    public files = 0;

    constructor(name: string) {
        super();
        this.name = name;
    }
    override add(value: Count) {
        this.files++;
        return super.add(value);
    }
}

const escapeMarkdown = (text: string): string => text.replace(/([\\`*_\[\]])/g, '\\$1');

class MarkdownTableFormatter {
    private valueToString: (obj: any) => string;
    private columnInfo: { title: string, format: string }[];
    constructor(valueToString: (obj: any) => string, ...columnInfo: { title: string, format: string }[]) {
        this.valueToString = valueToString;
        this.columnInfo = columnInfo;
    }
    get lineSeparator() {
        return '| ' + this.columnInfo.map(i => (i.format === 'number') ? '---:' : ':---').join(' | ') + ' |';
    }
    get headerLines() {
        return ['| ' + this.columnInfo.map(i => i.title).join(' | ') + ' |', this.lineSeparator];
    }
    public line(...data: (string | number | vscode.Uri)[]) {
        return '| ' + data.map((d, i) => {
            if (typeof d === 'number') {
                return this.valueToString(d);
            }
            if (typeof d === 'string') {
                return d;
            }
            const relativePath = vscode.workspace.asRelativePath(d);
            return `[${escapeMarkdown(relativePath)}](/${encodeURI(relativePath)})`;
        }).join(' | ') + ' |';
    }
}

const stringCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const nameCompare = <T extends { name: string }>(a: T, b: T) => stringCompare(a.name, b.name);
const filenameCompare = <T extends { filename: string }>(a: T, b: T) => stringCompare(a.filename, b.filename);

class ResultFormatter {
    private dirResultTable = new Map<string, Statistics>();
    private langResultTable = new Map<string, Statistics>();
    private total = new Statistics('Total');
    private endOfLine: string;
    private valueToString: (obj: any) => string;

    constructor(private targetDirUri: vscode.Uri, private results: Result[], conf: { countDirectLevelFiles: boolean, endOfLine: string, printNumberWithCommas: boolean }) {
        this.endOfLine = conf.endOfLine;
        this.valueToString = conf.printNumberWithCommas ? toStringWithCommas : (obj: any) => obj.toString();

        const directLevelResultTable = new Map<string, Statistics>();
        results.forEach((result) => {
            let parent = path.dirname(path.relative(this.targetDirUri.fsPath, result.filename));
            getOrSet(directLevelResultTable, parent, () => new Statistics(parent + ' (Files)')).add(result);
            while (parent.length >= 0) {
                getOrSet(this.dirResultTable, parent, () => new Statistics(parent)).add(result);
                const p = path.dirname(parent);
                if (p === parent) {
                    break;
                }
                parent = p;
            }
            getOrSet(this.langResultTable, result.language, () => new Statistics(result.language)).add(result);
            this.total.add(result);
        });
        if (conf.countDirectLevelFiles) {
            [...directLevelResultTable.entries()].filter(([key, value]) => {
                log(`  dir[${value.name}] total=${value.total}  ${(this.dirResultTable.get(key)?.total ?? 0)}`);
                return value.total !== (this.dirResultTable.get(key)?.total ?? 0);
            }).forEach(([, value]) => this.dirResultTable.set(value.name, value));
        }
    }
    toCSVLines() {
        const languages = [...this.langResultTable.keys()];
        return [
            `"filename", "language", "${languages.join('", "')}", "comment", "blank", "total"`,
            ...this.results.sort(filenameCompare)
                .map(v => `"${v.filename}", "${v.language}", ${languages.map(l => l === v.language ? v.code : 0).join(', ')}, ${v.comment}, ${v.blank}, ${v.total}`),
            `"Total", "-", ${[...this.langResultTable.values()].map(r => r.code).join(', ')}, ${this.total.comment}, ${this.total.blank}, ${this.total.total}`
        ].join(this.endOfLine);
    }
    toTextLines(date: Date) {
        class TextTableFormatter {
            private valueToString: (obj: any) => string;
            private columnInfo: { title: string, width: number }[];
            constructor(valueToString: (obj: any) => string, ...columnInfo: { title: string, width: number }[]) {
                this.valueToString = valueToString;
                this.columnInfo = columnInfo;
                for (const info of this.columnInfo) {
                    info.width = Math.max(info.title.length, info.width);
                }
            }
            public get lineSeparator() {
                return '+-' + this.columnInfo.map(i => '-'.repeat(i.width)).join('-+-') + '-+';
            }
            get headerLines() {
                return [this.lineSeparator, '| ' + this.columnInfo.map(i => i.title.padEnd(i.width)).join(' | ') + ' |', this.lineSeparator];
            }
            get footerLines() {
                return [this.lineSeparator];
            }
            public line(...data: (string | number | boolean)[]) {
                return '| ' + data.map((d, i) => {
                    if (typeof d === 'string') {
                        return d.padEnd(this.columnInfo[i].width);
                    } else {
                        return this.valueToString(d).padStart(this.columnInfo[i].width);
                    }
                }).join(' | ') + ' |';
            }
        }
        const maxNamelen = Math.max(...this.results.map(res => res.filename.length));
        const maxLanglen = Math.max(...[...this.langResultTable.keys()].map(l => l.length));
        const resultFormat = new TextTableFormatter(this.valueToString, { title: 'filename', width: maxNamelen }, { title: 'language', width: maxLanglen },
            { title: 'code', width: 10 }, { title: 'comment', width: 10 }, { title: 'blank', width: 10 }, { title: 'total', width: 10 });
        const dirFormat = new TextTableFormatter(this.valueToString, { title: 'path', width: maxNamelen }, { title: 'files', width: 10 },
            { title: 'code', width: 10 }, { title: 'comment', width: 10 }, { title: 'blank', width: 10 }, { title: 'total', width: 10 });
        const langFormat = new TextTableFormatter(this.valueToString, { title: 'language', width: maxLanglen }, { title: 'files', width: 10 },
            { title: 'code', width: 10 }, { title: 'comment', width: 10 }, { title: 'blank', width: 10 }, { title: 'total', width: 10 });
        return [
            `Date : ${toLocalDateString(date)}`,
            `Directory : ${this.targetDirUri.fsPath}`,
            `Total : ${this.total.files} files,  ${this.total.code} codes, ${this.total.comment} comments, ${this.total.blank} blanks, all ${this.total.total} lines`,
            '',
            'Languages',
            ...langFormat.headerLines,
            ...[...this.langResultTable.values()].sort((a, b) => b.code - a.code)
                .map(v => langFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            ...langFormat.footerLines,
            '',
            'Directories',
            ...dirFormat.headerLines,
            ...[...this.dirResultTable.values()].sort(nameCompare)
                .map(v => dirFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            ...dirFormat.footerLines,
            '',
            'Files',
            ...resultFormat.headerLines,
            ...this.results.sort(filenameCompare)
                .map(v => resultFormat.line(v.filename, v.language, v.code, v.comment, v.blank, v.total)),
            resultFormat.line('Total', '', this.total.code, this.total.comment, this.total.blank, this.total.total),
            ...resultFormat.footerLines,
        ].join(this.endOfLine);
    }
    toDocument(date: Date): string {
        return [
            '# Code Counter',
            '',
            ...this.toMarkdownHeaderLines(date),
            '',
            ...this.toMarkdownSummaryLines(),
            '',
            ...this.toMarkdownDetailsLines(),
        ].join(this.endOfLine);
    }
    toMarkdown(date: Date, title: string, detail: boolean, links: [string, string | undefined][]) {
        const linksStr = links.map(l => l[1] ? `[${l[0]}](${l[1]})` : l[0]).join(' / ');
        return [
            `# ${title}`,
            '',
            ...this.toMarkdownHeaderLines(date),
            '',
            linksStr,
            '',
            ...(detail ? this.toMarkdownDetailsLines() : this.toMarkdownSummaryLines()),
            '',
            linksStr,
        ].join(this.endOfLine);
    }

    private toMarkdownHeaderLines(date: Date) {
        return [
            `Date : ${toLocalDateString(date)}`,
            '',
            `Directory ${this.targetDirUri.fsPath.replace(/\\/g, '\\\\')}`,
            '',
            `Total : ${this.total.files} files,  ${this.total.code} codes, ${this.total.comment} comments, ${this.total.blank} blanks, all ${this.total.total} lines`,
        ];
    }
    private toMarkdownSummaryLines() {
        const dirFormat = new MarkdownTableFormatter(this.valueToString,
            { title: 'path', format: 'string' },
            { title: 'files', format: 'number' },
            { title: 'code', format: 'number' },
            { title: 'comment', format: 'number' },
            { title: 'blank', format: 'number' },
            { title: 'total', format: 'number' }
        );
        const langFormat = new MarkdownTableFormatter(this.valueToString,
            { title: 'language', format: 'string' },
            { title: 'files', format: 'number' },
            { title: 'code', format: 'number' },
            { title: 'comment', format: 'number' },
            { title: 'blank', format: 'number' },
            { title: 'total', format: 'number' }
        );
        return [
            '## Languages',
            ...langFormat.headerLines,
            ...[...this.langResultTable.values()].sort((a, b) => b.code - a.code)
                .map(v => langFormat.line(v.name, v.files, v.code, v.comment, v.blank, v.total)),
            '',
            '## Directories',
            ...dirFormat.headerLines,
            ...[...this.dirResultTable.values()].sort(nameCompare)
                .map(v => dirFormat.line(v.name.replace(/\\/g, '\\\\'), v.files, v.code, v.comment, v.blank, v.total)),
        ];
    }
    private toMarkdownDetailsLines() {
        const resultFormat = new MarkdownTableFormatter(this.valueToString,
            { title: 'filename', format: 'uri' },
            { title: 'language', format: 'string' },
            { title: 'code', format: 'number' },
            { title: 'comment', format: 'number' },
            { title: 'blank', format: 'number' },
            { title: 'total', format: 'number' }
        );
        return [
            '## Files',
            ...resultFormat.headerLines,
            ...this.results.sort(filenameCompare)
                .map(v => resultFormat.line(v.uri, v.language, v.code, v.comment, v.blank, v.total)),
        ];
    }
}


const mapToObject = <T>(map: Map<string, T>) => {
    const obj: { [key: string]: T } = {};
    map.forEach((v, id) => {
        obj[id] = v;
    });
    return obj;
};

const getOrSet = <K, V>(map: Map<K, V>, key: K, otherwise: () => V) => {
    let v = map.get(key);
    if (v === undefined) {
        v = otherwise();
        map.set(key, v);
    }
    return v;
};
