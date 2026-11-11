# Styled JSX

Syntax highlighting and language features for [styled-jsx](https://github.com/vercel/styled-jsx).

Maintained by che-11. Syntax highlighting comes from [vscode-styled-jsx](https://github.com/iFwu/vscode-styled-jsx) by Graham Clark, Julien Poissonnier, and Xiao Fu. That grammar is based on [vscode-styled-components](https://github.com/styled-components/vscode-styled-components) and the Atom [language-css](https://github.com/atom/language-css) grammar. The language server comes from [vscode-styled-jsx-languageserver](https://github.com/Grimones/vscode-styled-jsx-languageserver) by Andrew Razumovsky, and uses the Visual Studio Code CSS language service.

## Highlighting

`<style jsx>` blocks and `css`, `css.global`, and `css.resolve` template literals are highlighted as CSS inside JavaScript and TypeScript.

## Language features

Inside those CSS regions the extension provides completion, hover, diagnostics, color decorators, document symbols, go to definition, references, highlights, and quick fixes. It follows the editor's CSS settings.

Template expressions such as `${props.color}` stay in the source, and the language features skip them.

## Development

Open this folder and press F5. `pnpm test` compiles and runs the styled-jsx helper tests. `pnpm run package` writes `builds/ce-styled-jsx-<version>.vsix`.
