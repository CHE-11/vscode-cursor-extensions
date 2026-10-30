import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface BackendMatch {
  method: string;
  endpoint: string;
  file: string;
  uri: string;
}

interface FrontendMatch {
  method: string;
  endpoint: string;
  file: string;
  uri: string;
}

interface EndpointerConfig {
  enabled: boolean;
  frontend: {
    folders_to_include: string[];
    extensions_to_include: string[];
  };
  backend: {
    folders_to_include: string[];
    extensions_to_include: string[];
  };
}

type TreeNode = SegmentItem | MethodItem | FrontendCallItem;

async function loadEndpointerConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<EndpointerConfig | undefined> {
  const configPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'endpointer.json');

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const fileContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(fileContent) as Partial<EndpointerConfig>;

    return {
      enabled: config.enabled === true,
      frontend: {
        folders_to_include: config.frontend?.folders_to_include ?? [],
        extensions_to_include: config.frontend?.extensions_to_include ?? []
      },
      backend: {
        folders_to_include: config.backend?.folders_to_include ?? [],
        extensions_to_include: config.backend?.extensions_to_include ?? []
      }
    };
  } catch (error) {
    console.error('Error reading endpointer.json:', error);
    return undefined;
  }
}

function matchesConfig(filePath: string, workspaceRoot: string, folders: string[], extensions: string[]): boolean {
  // If both are empty, include everything
  if (folders.length === 0 && extensions.length === 0) {
    return true;
  }

  // Get relative path from workspace root
  let relativePath: string;
  if (filePath.startsWith(workspaceRoot)) {
    relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
  } else {
    relativePath = filePath.replace(/\\/g, '/');
  }

  // Clean folder paths (remove leading slashes)
  const cleanFolders = folders.map(f => f.startsWith('/') ? f.substring(1) : f);
  
  // Clean extensions (ensure they start with a dot)
  const cleanExtensions = extensions.map(e => e.startsWith('.') ? e : '.' + e);
  
  const fileExt = path.extname(filePath);

  // Check folder match
  let folderMatch = cleanFolders.length === 0;
  if (!folderMatch) {
    folderMatch = cleanFolders.some(folder => {
      const normalizedFolder = folder.replace(/\\/g, '/');
      return relativePath.startsWith(normalizedFolder + '/') || relativePath === normalizedFolder;
    });
  }

  // Check extension match
  let extMatch = cleanExtensions.length === 0;
  if (!extMatch) {
    extMatch = cleanExtensions.includes(fileExt);
  }

  // Both must match if both are specified, otherwise just the specified one needs to match
  if (cleanFolders.length > 0 && cleanExtensions.length > 0) {
    return folderMatch && extMatch;
  } else if (cleanFolders.length > 0) {
    return folderMatch;
  } else {
    return extMatch;
  }
}

export class RoutesProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | void> = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | void> = this._onDidChangeTreeData.event;
  private roots: SegmentItem[] = [];

  constructor(private workspaceRoot: string, private context: vscode.ExtensionContext) {}

  refresh(): void {
    this.roots = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No routes in empty workspace');
      return Promise.resolve([]);
    }

    if (!element) {
      if (this.roots.length === 0) {
        return this.buildTree().then(() => {
          const sortedRoots = this.roots.sort((a, b) => (a.label as string).localeCompare(b.label as string));
          return sortedRoots;
        });
      }
      const sortedRoots = this.roots.sort((a, b) => (a.label as string).localeCompare(b.label as string));
      return Promise.resolve(sortedRoots);
    }

    if (element instanceof SegmentItem) {
      return Promise.resolve(element.getSortedChildren());
    }

    if (element instanceof MethodItem) {
      return Promise.resolve(element.getFrontendCalls());
    }

    return Promise.resolve([]);
  }

  private async buildTree(): Promise<void> {
    const matches: BackendMatch[] = this.context.globalState.get('backendMatches', []);
    const frontendMatches: FrontendMatch[] = this.context.globalState.get('frontEndMatches', []);
    
    // Load config and filter matches
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.roots = [];
      return;
    }

    const config = await loadEndpointerConfig(workspaceFolder);
    if (!config?.enabled) {
      this.roots = [];
      return;
    }
    const workspaceRoot = workspaceFolder.uri.fsPath;

    // Filter backend matches
    const filteredBackendMatches = matches.filter(match => 
      matchesConfig(match.file, workspaceRoot, config.backend.folders_to_include, config.backend.extensions_to_include)
    );

    // Filter frontend matches
    const filteredFrontendMatches = frontendMatches.filter(match => 
      matchesConfig(match.file, workspaceRoot, config.frontend.folders_to_include, config.frontend.extensions_to_include)
    );

    const segmentRootByName = new Map<string, SegmentItem>();

    for (const match of filteredBackendMatches) {
      const endpoint = sanitizeEndpoint(match.endpoint);
      const segments = endpoint.split('/').filter(Boolean);

      // Find all frontend calls that match this backend endpoint (and are also filtered)
      const matchingFrontendCalls = filteredFrontendMatches.filter(
        fm => fm.method === match.method && fm.endpoint === match.endpoint
      );

      if (segments.length === 0) {
        // root endpoint '/': put method directly under a synthetic root segment
        let rootSeg = segmentRootByName.get('/');
        if (!rootSeg) {
          rootSeg = new SegmentItem('/', vscode.TreeItemCollapsibleState.Collapsed);
          segmentRootByName.set('/', rootSeg);
        }
        rootSeg.addChild(new MethodItem(match.method, match.endpoint, vscode.Uri.file(match.file), match.uri, matchingFrontendCalls));
        continue;
      }

      // ensure top-level segment
      const first = segments[0];
      let current = segmentRootByName.get(first);
      if (!current) {
        current = new SegmentItem(first, vscode.TreeItemCollapsibleState.Collapsed);
        segmentRootByName.set(first, current);
      }

      // walk/create sub-segments
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        current = current.getOrCreateChildSegment(seg);
      }

      // attach method leaf to the final segment
      current.addChild(new MethodItem(match.method, match.endpoint, vscode.Uri.file(match.file), match.uri, matchingFrontendCalls));
    }

    this.roots = Array.from(segmentRootByName.values());
  }
}

export class FrontendCallsProvider implements vscode.TreeDataProvider<FrontendCallItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FrontendCallItem | undefined | void> = new vscode.EventEmitter<FrontendCallItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FrontendCallItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string, private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FrontendCallItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FrontendCallItem): Thenable<FrontendCallItem[]> {
    if (!this.workspaceRoot) {
      return Promise.resolve([]);
    }

    if (!element) {
      const frontendMatches: FrontendMatch[] = this.context.globalState.get('frontEndMatches', []);
      
      // Load config and filter matches
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return Promise.resolve([]);
      }

      return loadEndpointerConfig(workspaceFolder).then(config => {
        if (!config?.enabled) {
          return [];
        }
        const workspaceRoot = workspaceFolder.uri.fsPath;
        const filteredMatches = frontendMatches.filter(match => 
          matchesConfig(match.file, workspaceRoot, config.frontend.folders_to_include, config.frontend.extensions_to_include)
        );
        const sharedPrefix = getSharedFrontendApiPrefix(filteredMatches.map(match => match.endpoint));

        return filteredMatches
          .map(fm => {
            const displayEndpoint = trimEndpointPrefix(fm.endpoint, sharedPrefix);
            return new FrontendCallItem(fm.file, fm.uri, fm.method, fm.endpoint, displayEndpoint);
          })
          .sort((a, b) => (a.label as string).localeCompare((b.label as string), undefined, { sensitivity: 'base' }));
      });
    }

    return Promise.resolve([]);
  }
}

class SegmentItem extends vscode.TreeItem {
  private children: TreeNode[] = [];

  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState);
    this.contextValue = 'segment';
    this.tooltip = label;
  }

  addChild(child: TreeNode): void {
    this.children.push(child);
  }

  getOrCreateChildSegment(label: string): SegmentItem {
    const existing = this.children.find(c => c instanceof SegmentItem && c.label === label) as SegmentItem | undefined;
    if (existing) return existing;
    const seg = new SegmentItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.children.push(seg);
    return seg;
  }

  getSortedChildren(): TreeNode[] {
    const segments: SegmentItem[] = [];
    const methods: MethodItem[] = [];
    for (const c of this.children) {
      if (c instanceof SegmentItem) segments.push(c);
      else if (c instanceof MethodItem) methods.push(c);
    }
    segments.sort((a, b) => (a.label as string).localeCompare(b.label as string));
    // sort methods by HTTP verb order then name
    const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    methods.sort((a, b) => {
      const ai = order.indexOf(a.method.toUpperCase());
      const bi = order.indexOf(b.method.toUpperCase());
      if (ai !== -1 && bi !== -1 && ai !== bi) return ai - bi;
      if (ai !== -1 && bi === -1) return -1;
      if (ai === -1 && bi !== -1) return 1;
      return (a.label as string).localeCompare(b.label as string);
    });
    return [...segments, ...methods];
  }
}

class MethodItem extends vscode.TreeItem {
  private frontendCalls: FrontendCallItem[] = [];
  public readonly callCount: number;

  constructor(
    public readonly method: string,
    public readonly endpoint: string,
    public readonly fileUri: vscode.Uri,
    public readonly openUri: string,
    frontendMatches: FrontendMatch[]
  ) {
    const callCount = frontendMatches.length;
    const collapsibleState = callCount > 0 
      ? vscode.TreeItemCollapsibleState.Collapsed 
      : vscode.TreeItemCollapsibleState.None;
    
    super(`${method} ${endpoint}`, collapsibleState);
    
    this.callCount = callCount;
    this.tooltip = `${this.method} ${this.endpoint} - ${this.fileUri.fsPath}`;
    this.description = callCount > 0 ? `${callCount}` : '';
    
    // Set command to open backend file on click
    this.command = {
      title: 'Open Backend Route',
      command: 'extension.openBackendRoute',
      arguments: [openUri]
    };
    
    this.iconPath = {
      light: vscode.Uri.file(path.join(__filename, '..', '..', 'src/resources', 'dark-endpoint.svg')),
      dark: vscode.Uri.file(path.join(__filename, '..', '..', 'src/resources', 'light-endpoint.svg'))
    };
    this.contextValue = 'method';

    // Create frontend call items
    this.frontendCalls = frontendMatches.map(fm => new FrontendCallItem(fm.file, fm.uri, fm.method, fm.endpoint));
  }

  getFrontendCalls(): FrontendCallItem[] {
    return this.frontendCalls;
  }
}

class FrontendCallItem extends vscode.TreeItem {
  private static getMethodColor(method: string): vscode.ThemeColor | undefined {
    switch (method.toUpperCase()) {
      case 'DELETE':
        return new vscode.ThemeColor('charts.red');
      case 'GET':
        return new vscode.ThemeColor('charts.green');
      case 'POST':
        return new vscode.ThemeColor('charts.yellow');
      case 'PUT':
        return new vscode.ThemeColor('charts.orange');
      default:
        return undefined;
    }
  }

  constructor(
    public readonly filePath: string,
    public readonly openUri: string,
    public readonly method?: string,
    public readonly endpoint?: string,
    public readonly displayEndpoint?: string
  ) {
    const fileName = path.basename(filePath);
    super(fileName, vscode.TreeItemCollapsibleState.None);
    
    // Create tooltip with method and endpoint if available
    if (method && endpoint) {
      this.tooltip = `${method} ${endpoint} - ${filePath}`;
    } else {
      this.tooltip = filePath;
    }
    
    // Show relative path or method+endpoint in description
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let description = filePath;
    if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
      description = path.relative(workspaceRoot, filePath);
    }
    
    // For standalone frontend calls list, show endpoint with method on the right
    if (method && endpoint) {
      const normalizedMethod = method.toUpperCase();
      this.label = displayEndpoint || endpoint;
      this.description = `${normalizedMethod} - ${fileName}`;
      const methodColor = FrontendCallItem.getMethodColor(normalizedMethod);
      this.iconPath = new vscode.ThemeIcon('circle-filled', methodColor);
    } else {
      this.description = description;
    }
    
    this.command = {
      title: 'Open Frontend File',
      command: 'extension.openEndpoint',
      arguments: [openUri]
    };
    this.contextValue = 'frontendCall';
  }
}

function sanitizeEndpoint(endpoint: string): string {
  // Normalize whitespace and strip query/fragments if present (defensive)
  const cleaned = endpoint.split('?')[0].split('#')[0].trim();
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function getSharedFrontendApiPrefix(endpoints: string[]): string {
  if (endpoints.length === 0) {
    return '';
  }

  const splitSegments = endpoints.map(endpoint => sanitizeEndpoint(endpoint).split('/').filter(Boolean));
  const minLength = Math.min(...splitSegments.map(segments => segments.length));
  const sharedSegments: string[] = [];

  for (let index = 0; index < minLength; index++) {
    const segment = splitSegments[0][index];
    const isShared = splitSegments.every(segments => segments[index].toLowerCase() === segment.toLowerCase());
    if (!isShared) {
      break;
    }
    sharedSegments.push(segment);
  }

  if (sharedSegments.length === 0 || sharedSegments[0].toLowerCase() !== 'api') {
    return '';
  }

  return `/${sharedSegments.join('/')}`;
}

function trimEndpointPrefix(endpoint: string, prefix: string): string {
  const normalizedEndpoint = sanitizeEndpoint(endpoint);
  if (!prefix) {
    return normalizedEndpoint;
  }

  if (normalizedEndpoint === prefix) {
    return '/';
  }

  if (normalizedEndpoint.startsWith(`${prefix}/`)) {
    return normalizedEndpoint.substring(prefix.length);
  }

  return normalizedEndpoint;
}