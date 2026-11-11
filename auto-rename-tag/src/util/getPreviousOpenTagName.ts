import { ScannerFast, ScannerStateFast, TokenTypeFast } from '../htmlScanner/htmlScannerFast';
import { getIndent } from './getIndent';

export interface OpeningTag {
  tagName: string;
  offset: number;
  seenRightAngleBracket: boolean;
  indent: number;
}

export function getPreviousOpeningTagName(
  scanner: ScannerFast,
  initialOffset: number,
  isSelfClosingTag: (tagName: string) => boolean,
  isReact: boolean,
): OpeningTag | undefined {
  let offset = initialOffset + 1;
  let parentTagName: string | undefined;
  const stack: string[] = [];
  let seenRightAngleBracket = false;
  let selfClosing = false;
  outer: do {
    scanner.stream.goTo(offset - 2);
    const hasFoundChar = scanner.stream.goBackUntilEitherChar(['<', '>'], false, isReact);
    if (!hasFoundChar) {
      return undefined;
    }
    const char = scanner.stream.peekLeft(1);
    if (char !== '<' && char !== '>') {
      return undefined;
    }
    if (char === '>') {
      if (scanner.stream.peekLeft(2) === '/') {
        selfClosing = true;
      }
      seenRightAngleBracket = true;
      scanner.stream.goBack(1);
      scanner.stream.goBackUntilEitherChar(['<'], true, isReact);
      offset = scanner.stream.position;
    }
    if (scanner.stream.peekRight() === '/') {
      offset = scanner.stream.position;
      scanner.stream.advance(1);
      scanner.state = ScannerStateFast.AfterOpeningEndTag;
      scanner.scan();
      const token = scanner.getTokenText();
      if (token === '') {
        offset = scanner.stream.position - 1;
        continue;
      }
      stack.push(scanner.getTokenText());
      continue;
    }
    offset = scanner.stream.position;
    scanner.state = ScannerStateFast.AfterOpeningStartTag;
    const token = scanner.scan();
    if (token !== TokenTypeFast.StartTag) {
      return undefined;
    }
    const tokenText = scanner.getTokenText();
    if (selfClosing) {
      selfClosing = false;
      continue;
    }
    if (isSelfClosingTag(tokenText)) {
      continue;
    }
    inner: while (stack.length) {
      const top = stack.pop();
      if (top === tokenText) {
        continue outer;
      }
      if (top !== undefined && isSelfClosingTag(top)) {
        continue inner;
      }
      return undefined;
    }

    parentTagName = tokenText;
    if (parentTagName !== undefined) {
      break;
    }
  } while (true);

  if (parentTagName === undefined) {
    return undefined;
  }
  return {
    tagName: parentTagName,
    offset,
    seenRightAngleBracket,
    indent: getIndent(scanner.stream.getSource(), offset - 2),
  };
}
