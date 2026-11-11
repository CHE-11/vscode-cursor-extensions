import { ScannerFast, ScannerStateFast, TokenTypeFast } from '../htmlScanner/htmlScannerFast';
import { getIndent } from './getIndent';

export interface ClosingTag {
  tagName: string;
  offset: number;
  seenRightAngleBracket: boolean;
  indent: number;
}

export function getNextClosingTagName(
  scanner: ScannerFast,
  initialOffset: number,
  isSelfClosingTag: (tagName: string) => boolean,
  isReact = false,
): ClosingTag | undefined {
  let offset = initialOffset;
  let nextClosingTagName: string | undefined;
  const stack: string[] = [];
  const seenRightAngleBracket = false;
  scanner.stream.goTo(offset);
  do {
    const hasFoundChar = scanner.stream.advanceUntilEitherChar(['<', '>'], false, isReact);
    if (!hasFoundChar) {
      return undefined;
    }
    const char = scanner.stream.peekRight();
    if (char !== '<' && char !== '>') {
      return undefined;
    }
    if (char === '<') {
      if (scanner.stream.peekRight(1) === '/') {
        scanner.stream.advance(2);
        offset = scanner.stream.position;
        scanner.state = ScannerStateFast.AfterOpeningEndTag;
        const token = scanner.scan();
        if (token !== TokenTypeFast.EndTag) {
          return undefined;
        }
        const tokenText = scanner.getTokenText();
        if (stack.length) {
          const top = stack.pop();
          if (top !== tokenText) {
            return undefined;
          }
          continue;
        }
        nextClosingTagName = tokenText;
        if (nextClosingTagName !== undefined) {
          break;
        }
      }

      scanner.stream.advance(1);
      scanner.state = ScannerStateFast.AfterOpeningStartTag;
      const token = scanner.scan();
      if (token !== TokenTypeFast.StartTag) {
        return undefined;
      }
      const tokenText = scanner.getTokenText();
      if (isSelfClosingTag(tokenText)) {
        scanner.stream.advanceUntilEitherChar(['>'], true, isReact);
        scanner.stream.advance(1);
        continue;
      }
      stack.push(tokenText);
      continue;
    }
    if (scanner.stream.peekRight(1) === '') {
      return undefined;
    }
    if (scanner.stream.previousChars(2) === '--') {
      return undefined;
    }
    if (scanner.stream.peekLeft(1) === '/') {
      const charBefore = scanner.stream.peekLeft(2);
      if (!/[\s"'\}]/.test(charBefore)) {
        const codeBefore = scanner.stream.getSource().slice(0, scanner.stream.position);
        if (/href=[^\s]+$/.test(codeBefore)) {
          scanner.stream.advance(1);
          continue;
        }
      }
      if (stack.length === 0) {
        return undefined;
      }
      stack.pop();
      scanner.stream.advance(1);
      continue;
    }
    scanner.stream.advance(1);
  } while (true);

  if (nextClosingTagName === undefined) {
    return undefined;
  }
  return {
    tagName: nextClosingTagName,
    offset,
    seenRightAngleBracket,
    indent: getIndent(scanner.stream.getSource(), offset - 3),
  };
}
