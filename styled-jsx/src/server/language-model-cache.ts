/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument } from 'vscode-languageserver-textdocument';

export interface LanguageModelCache<T> {
  get(document: TextDocument): T;
  onDocumentRemoved(document: TextDocument): void;
  dispose(): void;
}

interface LanguageModelInfo<T> {
  version: number;
  languageId: string;
  cTime: number;
  languageModel: T;
}

export function getLanguageModelCache<T>(
  maxEntries: number,
  cleanupIntervalTimeInSec: number,
  parse: (document: TextDocument) => T,
): LanguageModelCache<T> {
  let languageModels: Record<string, LanguageModelInfo<T>> = {};
  let nModels = 0;
  let cleanupInterval: ReturnType<typeof setInterval> | undefined;

  if (cleanupIntervalTimeInSec > 0) {
    cleanupInterval = setInterval(() => {
      const cutoffTime = Date.now() - cleanupIntervalTimeInSec * 1000;
      for (const uri of Object.keys(languageModels)) {
        const languageModelInfo = languageModels[uri];
        if (languageModelInfo.cTime < cutoffTime) {
          delete languageModels[uri];
          nModels--;
        }
      }
    }, cleanupIntervalTimeInSec * 1000);
  }

  return {
    get(document: TextDocument): T {
      const version = document.version;
      const languageId = document.languageId;
      const languageModelInfo = languageModels[document.uri];
      if (languageModelInfo && languageModelInfo.version === version && languageModelInfo.languageId === languageId) {
        languageModelInfo.cTime = Date.now();
        return languageModelInfo.languageModel;
      }

      const languageModel = parse(document);
      languageModels[document.uri] = { languageModel, version, languageId, cTime: Date.now() };
      if (!languageModelInfo) {
        nModels++;
      }

      if (nModels === maxEntries) {
        let oldestTime = Number.MAX_VALUE;
        let oldestUri: string | undefined;
        for (const uri in languageModels) {
          const candidate = languageModels[uri];
          if (candidate.cTime < oldestTime) {
            oldestUri = uri;
            oldestTime = candidate.cTime;
          }
        }
        if (oldestUri) {
          delete languageModels[oldestUri];
          nModels--;
        }
      }
      return languageModel;
    },
    onDocumentRemoved(document: TextDocument) {
      if (languageModels[document.uri]) {
        delete languageModels[document.uri];
        nModels--;
      }
    },
    dispose() {
      if (cleanupInterval !== undefined) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
        languageModels = {};
        nModels = 0;
      }
    },
  };
}
