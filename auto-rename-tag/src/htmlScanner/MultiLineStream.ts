const quotes = new Set(['`', '"', "'"]);

export class MultiLineStream {
  public position: number;

  private source: string;
  private length: number;
  private matchingTagPairs: readonly [string, string][];
  private nonQuoteMatchingTagPairs: readonly [string, string][];

  constructor(source: string, position: number, matchingTagPairs: readonly [string, string][]) {
    this.source = source;
    this.length = source.length;
    this.position = position;
    this.matchingTagPairs = matchingTagPairs;
    this.nonQuoteMatchingTagPairs = matchingTagPairs.filter((matchingTagPair) => !quotes.has(matchingTagPair[0]));
  }

  public eos(): boolean {
    return this.length <= this.position;
  }

  public getSource(): string {
    return this.source;
  }

  public goTo(position: number): void {
    this.position = position;
  }

  public goBack(n: number): void {
    this.position -= n;
  }

  public advance(n: number): void {
    this.position += n;
  }

  private goToEnd(): void {
    this.position = this.source.length;
  }

  private goBackToUntilChars(chars: string): void {
    const reversedChars = chars.split('').reverse().join('');
    outer: while (this.position >= 0) {
      for (let i = 0; i < reversedChars.length; i++) {
        if (this.source[this.position - i] !== reversedChars[i]) {
          this.position--;
          continue outer;
        }
      }
      break;
    }
    this.position++;
  }

  public goBackUntilEitherChar(chars: string[], skipQuotes: boolean, isReact: boolean): boolean {
    const specialCharSet = new Set(isReact ? ['{', '}'] : []);
    while (this.position >= 0) {
      if (isReact && specialCharSet.has(this.source[this.position])) {
        if (this.source[this.position] === '{') {
          return false;
        }
        if (this.source[this.position] === '}') {
          let stackSize = 1;
          while (--this.position > 0) {
            if (this.source[this.position] === '}') {
              stackSize++;
            } else if (this.source[this.position] === '{') {
              stackSize--;
              if (stackSize === 0) {
                break;
              }
            }
          }
        }
      }
      outerForLoop1: for (const matchingTagPair of this.nonQuoteMatchingTagPairs) {
        for (let j = 0; j < matchingTagPair[0].length; j++) {
          if (matchingTagPair[0][matchingTagPair[0].length - 1 - j] !== this.source[this.position - j]) {
            continue outerForLoop1;
          }
        }
        return false;
      }
      outerForLoop2: for (const matchingTagPair of this.matchingTagPairs) {
        for (let i = 0; i < matchingTagPair[1].length; i++) {
          if (matchingTagPair[1][matchingTagPair[1].length - 1 - i] !== this.source[this.position - i]) {
            continue outerForLoop2;
          }
        }
        if (quotes.has(matchingTagPair[0])) {
          if (!skipQuotes) {
            this.goBack(1);
            return this.goBackUntilEitherChar(chars, skipQuotes, isReact);
          }
        }
        this.goBack(matchingTagPair[1].length);
        this.goBackToUntilChars(matchingTagPair[0]);
        this.goBack(matchingTagPair[0].length + 1);
        return this.goBackUntilEitherChar(chars, skipQuotes, isReact);
      }
      if (chars.includes(this.source[this.position])) {
        this.position++;
        return true;
      }
      this.position--;
    }
    return false;
  }

  public advanceUntilEitherChar(chars: string[], skipQuotes: boolean, isReact: boolean): boolean {
    const specialCharSet = new Set([
      ...chars,
      ...this.matchingTagPairs.map((pair) => pair[1][0]),
      ...this.matchingTagPairs.map((pair) => pair[0][0]),
      ...(isReact ? ['{', '}'] : []),
    ]);
    while (this.position < this.source.length) {
      if (!specialCharSet.has(this.source[this.position])) {
        this.position++;
        continue;
      }
      if (isReact) {
        if (this.source[this.position] === '{') {
          let stackSize = 1;
          while (++this.position < this.source.length) {
            if (this.source[this.position] === '{') {
              stackSize++;
            } else if (this.source[this.position] === '}') {
              stackSize--;
              if (stackSize === 0) {
                this.position++;
                break;
              }
            }
          }
        } else if (this.source[this.position] === '}') {
          return false;
        }
      }
      outerForLoop1: for (const matchingTagPair of this.nonQuoteMatchingTagPairs) {
        for (let j = 0; j < matchingTagPair[1].length; j++) {
          if (matchingTagPair[1][j] !== this.source[this.position + j]) {
            continue outerForLoop1;
          }
        }
        return false;
      }
      outerForLoop2: for (const matchingTagPair of this.matchingTagPairs) {
        for (let i = 0; i < matchingTagPair[0].length; i++) {
          if (matchingTagPair[0][i] !== this.source[this.position + i]) {
            continue outerForLoop2;
          }
        }
        if (quotes.has(matchingTagPair[0])) {
          if (!skipQuotes) {
            this.advance(1);
            return this.advanceUntilEitherChar(chars, skipQuotes, isReact);
          }
        }
        this.advance(matchingTagPair[0].length);
        this.advanceUntilChars(matchingTagPair[1]);
        this.advance(matchingTagPair[1].length);
        return this.advanceUntilEitherChar(chars, skipQuotes, isReact);
      }
      if (chars.includes(this.source[this.position])) {
        return true;
      }
      this.position++;
    }
    return false;
  }

  public peekLeft(n = 0): string {
    return this.source[this.position - n] ?? '';
  }

  public previousChars(n: number): string {
    return this.source.slice(this.position - n, this.position);
  }

  public peekRight(n = 0): string {
    return this.source[this.position + n] || '';
  }

  public advanceIfRegExp(regex: RegExp): string | undefined {
    const match = this.source.slice(this.position).match(regex);
    if (match) {
      this.position = this.position + (match.index ?? 0) + match[0].length;
      return match[0];
    }
    return undefined;
  }

  private advanceUntilChars(ch: string): boolean {
    while (this.position + ch.length <= this.source.length) {
      let i = 0;
      while (i < ch.length && this.source[this.position + i] === ch[i]) {
        i++;
      }
      if (i === ch.length) {
        return true;
      }
      this.advance(1);
    }
    this.goToEnd();
    return false;
  }
}
