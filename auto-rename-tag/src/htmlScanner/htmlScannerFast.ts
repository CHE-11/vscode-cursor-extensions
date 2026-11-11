import { MultiLineStream } from './MultiLineStream';

const htmlTagNameRE = /^[!:\w\$]((?![>\/])[\S])*/;
const htmlTagNameEmptyRE = /^\s+/;

export const enum TokenTypeFast {
  StartCommentTag,
  Comment,
  EndCommentTag,
  StartTagOpen,
  StartTagClose,
  StartTagSelfClose,
  StartTag,
  EndTagOpen,
  EndTagClose,
  EndTag,
  AttributeName,
  AttributeValue,
  Content,
  EOS,
  DelimiterAssign,
  Unknown,
  WhiteSpace,
}

export interface ScannerFast {
  readonly scan: () => TokenTypeFast;
  readonly getTokenText: () => string;
  readonly stream: MultiLineStream;
  state: ScannerStateFast;
}

export const enum ScannerStateFast {
  WithinContent,
  AfterOpeningStartTag,
  AfterOpeningEndTag,
  WithinStartTag,
  WithinEndTag,
  WithinComment,
  AfterAttributeName,
  BeforeAttributeValue,
}

export function createScannerFast({
  input,
  initialOffset,
  initialState,
  matchingTagPairs,
}: {
  input: string;
  initialOffset: number;
  initialState: ScannerStateFast;
  matchingTagPairs: readonly [string, string][];
}): ScannerFast {
  const stream = new MultiLineStream(input, initialOffset, matchingTagPairs);
  let state = initialState;
  let tokenOffset = 0;

  function nextElementName(): string | undefined {
    let result = stream.advanceIfRegExp(htmlTagNameRE);
    if (result === undefined && stream.advanceIfRegExp(htmlTagNameEmptyRE)) {
      result = '';
    }
    return result;
  }

  function scan(): TokenTypeFast {
    tokenOffset = stream.position;
    if (stream.eos()) {
      return TokenTypeFast.EOS;
    }
    switch (state) {
      case ScannerStateFast.AfterOpeningEndTag: {
        const tagName = nextElementName();
        if (tagName) {
          state = ScannerStateFast.WithinEndTag;
          return TokenTypeFast.EndTag;
        }
        if (stream.peekRight(0) === '>') {
          state = ScannerStateFast.WithinEndTag;
          return TokenTypeFast.EndTag;
        }
        return TokenTypeFast.Unknown;
      }
      case ScannerStateFast.AfterOpeningStartTag: {
        const tagName = nextElementName();
        if (tagName !== undefined) {
          if (tagName === '') {
            tokenOffset = stream.position;
          }
          state = ScannerStateFast.WithinStartTag;
          return TokenTypeFast.StartTag;
        }
        if (stream.peekRight() === '>') {
          state = ScannerStateFast.WithinStartTag;
          return TokenTypeFast.StartTag;
        }
        state = ScannerStateFast.WithinContent;
        return scan();
      }
      default:
        return TokenTypeFast.Unknown;
    }
  }

  return {
    scan,
    stream,
    getTokenText() {
      return stream.getSource().slice(tokenOffset, stream.position);
    },
    get state() {
      return state;
    },
    set state(newState: ScannerStateFast) {
      state = newState;
    },
  };
}
