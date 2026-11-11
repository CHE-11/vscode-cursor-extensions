import { Uri } from "vscode";

export interface Change {
  readonly uri: Uri;
}

export interface Repository {
  readonly state: {
    readonly workingTreeChanges: Change[];
  };
}

export interface API {
  readonly repositories: Repository[];
}

export interface GitExtension {
  getAPI(version: 1): API;
}
