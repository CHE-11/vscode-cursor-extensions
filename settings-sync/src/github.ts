import { apiBase, sameHostHttps } from './safe';

interface UndiciLike {
  ProxyAgent: new (uri: string) => object;
  fetch: (input: string, init?: unknown) => Promise<Response>;
}

export interface RemoteGist {
  id: string;
  public: boolean;
  description: string | null;
  ownerLogin: string | null;
  files: Record<string, { content: string }>;
}

export interface GistSummary {
  id: string;
  description: string;
  updatedAt: string;
  public: boolean;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function createClient(token: string, enterpriseUrl: string, proxy: string): Promise<GitHubClient> {
  return new GitHubClient(token, apiBase(enterpriseUrl), await clientFetch(proxy));
}

export function githubErrorMessage(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : 'GitHub request failed.';
  const redacted = token ? message.split(token).join('[token]') : message;
  return redacted.slice(0, 300);
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly api: string,
    private readonly fetchImpl: FetchLike
  ) {}

  public async getLogin(): Promise<string> {
    const payload = await this.request('GET', 'user');
    const login = typeof payload?.login === 'string' ? payload.login.trim() : '';
    if (!login) throw new Error('GitHub did not return a user name.');
    return login;
  }

  public async listGists(): Promise<GistSummary[]> {
    const payload = await this.request('GET', 'gists?per_page=100');
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      if (!/^[a-f0-9]{20,64}$/i.test(id)) return [];
      return [{
        id,
        description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : '(no description)',
        updatedAt: typeof record.updated_at === 'string' ? record.updated_at : '',
        public: record.public === true,
      }];
    });
  }

  public async getGist(id: string): Promise<RemoteGist> {
    const payload = await this.request('GET', `gists/${id}`);
    return parseGist(payload);
  }

  public async createGist(isPublic: boolean, description: string, files: Record<string, { content: string }>): Promise<string> {
    const payload = await this.request('POST', 'gists', {
      description,
      public: isPublic,
      files,
    });
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!/^[a-f0-9]{20,64}$/i.test(id)) throw new Error('GitHub did not return a Gist id.');
    return id;
  }

  public async updateGist(id: string, files: Record<string, { content: string } | null>): Promise<void> {
    await this.request('PATCH', `gists/${id}`, { files });
  }

  private async request(method: string, pathname: string, body?: unknown): Promise<any> {
    let current = joinApi(this.api, pathname);
    let nextMethod = method;
    let nextBody = body;

    for (let attempt = 0; attempt < 5; attempt++) {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ce-settings-sync',
      };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (nextBody !== undefined) headers['Content-Type'] = 'application/json';

      const response = await this.fetchImpl(current, {
        method: nextMethod,
        headers,
        body: nextBody === undefined ? undefined : JSON.stringify(nextBody),
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`GitHub redirect was missing a location (${response.status}).`);
        const next = sameHostHttps(current, location);
        if (!next) throw new Error('Refused a GitHub redirect to another host.');
        current = next;
        if (response.status !== 307 && response.status !== 308) {
          nextMethod = 'GET';
          nextBody = undefined;
        }
        continue;
      }

      const text = await response.text();
      const payload = parseJson(text);
      if (!response.ok) {
        const detail = typeof payload?.message === 'string' ? payload.message : response.statusText;
        throw new Error(`GitHub ${response.status}: ${detail}`);
      }
      return payload;
    }

    throw new Error('Too many GitHub redirects.');
  }
}

async function clientFetch(proxy: string): Promise<FetchLike> {
  if (!proxy) return fetch;
  try {
    const loadUndici = new Function('return import("undici")') as () => Promise<UndiciLike>;
    const undici = await loadUndici();
    const dispatcher = new undici.ProxyAgent(proxy);
    return (url, init) => undici.fetch(url, { ...init, dispatcher });
  } catch {
    throw new Error('http.proxy is set, but the built-in undici module did not load. The token was not sent.');
  }
}

function joinApi(api: string, pathname: string): string {
  const base = api.endsWith('/') ? api : `${api}/`;
  const pathPart = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return new URL(pathPart, base).toString();
}

function parseJson(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function parseGist(payload: any): RemoteGist {
  const id = typeof payload?.id === 'string' ? payload.id : '';
  if (!/^[a-f0-9]{20,64}$/i.test(id)) throw new Error('GitHub returned an invalid Gist id.');
  const owner = payload?.owner;
  return {
    id,
    public: payload?.public === true,
    description: typeof payload?.description === 'string' ? payload.description : null,
    ownerLogin: owner && typeof owner.login === 'string' ? owner.login.trim() : null,
    files: readFiles(payload?.files),
  };
}

function readFiles(files: unknown): Record<string, { content: string }> {
  const result: Record<string, { content: string }> = {};
  if (!files || typeof files !== 'object') return result;
  for (const [name, value] of Object.entries(files as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const file = value as { content?: unknown; truncated?: unknown };
    if (file.truncated === true) {
      throw new Error(`Gist file ${name} was truncated. Refusing to sync a partial file.`);
    }
    if (typeof file.content === 'string') result[name] = { content: file.content };
  }
  return result;
}
