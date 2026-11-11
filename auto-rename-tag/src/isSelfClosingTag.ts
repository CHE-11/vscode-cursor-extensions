const tagsThatAreSelfClosingInHtml = new Set([
  'area',
  'base',
  'br',
  'col',
  'command',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'menuitem',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const emptySet = new Set<string>();

const tagsThatAreSelfClosing: Record<string, Set<string>> = {
  css: tagsThatAreSelfClosingInHtml,
  ejs: tagsThatAreSelfClosingInHtml,
  ruby: tagsThatAreSelfClosingInHtml,
  html: tagsThatAreSelfClosingInHtml,
  markdown: tagsThatAreSelfClosingInHtml,
  marko: tagsThatAreSelfClosingInHtml,
  nunjucks: tagsThatAreSelfClosingInHtml,
  plaintext: tagsThatAreSelfClosingInHtml,
  php: tagsThatAreSelfClosingInHtml,
  javascript: tagsThatAreSelfClosingInHtml,
  javascriptreact: emptySet,
  mustache: tagsThatAreSelfClosingInHtml,
  razor: tagsThatAreSelfClosingInHtml,
  svelte: tagsThatAreSelfClosingInHtml,
  svg: emptySet,
  typescript: tagsThatAreSelfClosingInHtml,
  typescriptreact: emptySet,
  twig: tagsThatAreSelfClosingInHtml,
  volt: tagsThatAreSelfClosingInHtml,
  vue: emptySet,
  xml: emptySet,
};

export function isSelfClosingTagInLanguage(languageId: string): (tagName: string) => boolean {
  const tags = tagsThatAreSelfClosing[languageId] || tagsThatAreSelfClosing.html;
  return (tagName) => tags.has(tagName);
}
