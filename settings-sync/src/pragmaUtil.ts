import { OsType, osTypeFromString, SUPPORTED_OS } from './enums';

/**
 * Comment or uncomment lines that match an OS name, host name, or environment variable.
 * Usage: @sync os=[OS name] host=[hostName] env=[ENV_NAME]
 */
export default class PragmaUtil {
  public static processBeforeWrite(
    localContent: string,
    newContent: string,
    osType: OsType,
    hostName: string | null
  ): string {
    const parsedLines: string[] = [];
    const lines = newContent.split('\n');

    for (let index = 0; index < lines.length; index++) {
      let shouldComment = false;
      const currentLine = lines[index];
      if (this.PragmaRegExp.test(currentLine)) {
        try {
          const osMatch = currentLine.match(/os=(\w+)/);
          if (osMatch !== null) {
            const osFromPragma = osMatch[1].toLowerCase();
            if (!SUPPORTED_OS.includes(osFromPragma)) {
              continue;
            }
            if (osTypeFromString(osFromPragma) !== osType) {
              shouldComment = true;
            }
          }

          const hostMatch = currentLine.match(/host=(\S+)/);
          if (hostMatch !== null) {
            const hostFromPragma = hostMatch[1];
            if (
              hostName === null ||
              hostName === '' ||
              hostFromPragma.toLowerCase() !== hostName.toLowerCase()
            ) {
              shouldComment = true;
            }
          }

          const envMatch = currentLine.match(/env=(\S+)/);
          if (envMatch !== null) {
            const envFromPragma = envMatch[1];
            if (process.env[envFromPragma.toUpperCase()] === undefined) {
              shouldComment = true;
            }
          }
          parsedLines.push(currentLine);
          index = this.checkNextLines(lines, parsedLines, index, false, shouldComment);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Sync: Error processing pragmas ', message);
          continue;
        }
      } else if (this.IgnorePragmaRegExp.test(currentLine)) {
        index = this.checkNextLines(lines, parsedLines, index, true, false);
      } else {
        parsedLines.push(currentLine);
      }
    }

    let result = parsedLines.join('\n');
    const ignoredBlocks = this.getIgnoredBlocks(localContent);
    if (ignoredBlocks) {
      result = result.replace(/{\s*\n/, `{\n${ignoredBlocks}\n\n\n`);
    }

    const uncommented = this.removeAllComments(result).replace(/,\s*\}/g, ' }');
    try {
      JSON.parse(uncommented);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Sync: Result content is not a valid JSON.', message, uncommented);
    }

    return result;
  }

  public static async processBeforeUpload(fileContent: string): Promise<string> {
    const lines = fileContent.split('\n');
    const parsedLines: string[] = [];

    for (let index = 0; index < lines.length; index++) {
      let currentLine = lines[index];

      if (this.IgnorePragmaRegExp.test(currentLine)) {
        index = this.checkNextLines(lines, parsedLines, index, true);
      } else if (this.PragmaRegExp.test(currentLine)) {
        const osMatch = currentLine.match(this.OSPragmaWhiteSpacesSupportRegExp);
        if (osMatch !== null) {
          const osFromPragma = osMatch[1] || osMatch[2] || osMatch[3];
          if (osFromPragma !== '' && /\s/.test(osFromPragma)) {
            currentLine = currentLine.replace(osFromPragma, osFromPragma.trimStart());
          }
          const trimmed = osFromPragma.toLowerCase().trim();
          if (!SUPPORTED_OS.includes(trimmed)) {
            console.warn('Sync: Invalid OS', osFromPragma);
            throw new Error(`Sync Pragma OS value ${trimmed} not supported at line ${index + 1}`);
          }
        }

        const hostMatch = currentLine.match(this.HostPragmaWhiteSpacesSupportRegExp);
        if (hostMatch !== null) {
          const hostFromPragma = hostMatch[1] || hostMatch[2] || hostMatch[3];
          if (hostFromPragma !== '' && /\s/.test(hostFromPragma)) {
            currentLine = currentLine.replace(hostFromPragma, hostFromPragma.trimStart());
          }
        }

        const envMatch = currentLine.match(this.EnvPragmaWhiteSpacesSupportRegExp);
        if (envMatch !== null) {
          const envFromPragma = envMatch[1] || envMatch[2] || envMatch[3];
          if (envFromPragma !== '' && /\s/.test(envFromPragma)) {
            currentLine = currentLine.replace(envFromPragma, envFromPragma.trimStart());
          }
        }

        parsedLines.push(currentLine);
        index = this.checkNextLines(lines, parsedLines, index, false, false);
      } else {
        parsedLines.push(currentLine);
      }
    }
    return parsedLines.join('\n');
  }

  public static getIgnoredBlocks(content: string): string {
    content = content.replace(/@sync ignore/g, '@sync-ignore');
    const ignoredLines: string[] = [];
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const currentLine = lines[index];
      if (this.IgnorePragmaRegExp.test(currentLine)) {
        ignoredLines.push(currentLine);
        index = this.checkNextLines(lines, ignoredLines, index, false, false, true);
      }
    }
    return ignoredLines.join('\n');
  }

  public static removeAllComments(text: string): string {
    return text.replace(/(?<!["'].*)\s*(\/\/.+)|(\/\*.+\*\/)(?!["'].*)/g, '');
  }

  private static readonly PragmaRegExp: RegExp = /\/{2}[\s\t]*@sync[\s\t]+(?:os=.+[\s\t]*)?(?:host=.+[\s\t]*)?(?:env=.+[\s\t]*)?/;
  private static readonly IgnorePragmaRegExp: RegExp = /\/{2}[\s\t]*@sync-ignore/;
  private static readonly HostPragmaWhiteSpacesSupportRegExp = /(?:host=(.+)os=)|(?:host=(.+)env=)|host=(.+)\n?/;
  private static readonly OSPragmaWhiteSpacesSupportRegExp = /(?:os=(.+)host=)|(?:os=(.+)env=)|os=(.+)\n?/;
  private static readonly EnvPragmaWhiteSpacesSupportRegExp = /(?:env=(.+)host=)|(?:env=(.+)os=)|env=(.+)\n?/;
  private static readonly OpenBlockRegExp = /['"]\s*?:\s*[{\[]+\n*/;
  private static readonly CloseBlockRegExp = /(?<!["'].*)[}\]]+(?!["'].*)/;

  private static toggleComments(line: string, shouldComment: boolean): string {
    const isCommented = line.trim().startsWith('//');
    if (shouldComment) {
      return !isCommented ? line.replace(/^(\s*)/, '$1// ') : line;
    }
    return isCommented ? line.replace(/\/\/\s*/, '') : line;
  }

  private static checkNextLines(
    lines: string[],
    parsedLines: string[],
    currentIndex: number,
    shouldIgnore: boolean,
    shouldComment = false,
    checkTrailingComma = false
  ): number {
    let currentLine = lines[++currentIndex];
    if (checkTrailingComma && !currentLine.trim().endsWith(',')) {
      currentLine = currentLine.trimEnd() + ',';
    }
    if (!shouldIgnore) {
      parsedLines.push(this.toggleComments(currentLine, shouldComment));
    }

    let openBlocks = this.OpenBlockRegExp.test(currentLine) ? 1 : 0;
    while (openBlocks > 0) {
      currentLine = lines[++currentIndex];
      if (this.OpenBlockRegExp.test(currentLine)) {
        ++openBlocks;
      } else if (this.CloseBlockRegExp.test(currentLine)) {
        --openBlocks;
        if (checkTrailingComma && !currentLine.trim().endsWith(',')) {
          currentLine = currentLine.trimEnd() + ',';
        }
      }
      if (!shouldIgnore) {
        parsedLines.push(this.toggleComments(currentLine, shouldComment));
      }
    }

    return currentIndex;
  }
}
