/**
 * mammoth + turndown adapter for the convert facade.
 *
 * This is the ONLY file that may import the conversion libraries (enforced by
 * ESLint `no-restricted-imports`). mammoth reads the .docx into semantic HTML —
 * it keeps structure (headings, lists, tables, emphasis, links, images) and
 * drops presentation (fonts, sizes, colors), which is exactly what a diff view
 * wants. turndown writes that HTML as Markdown; the rules below make the
 * output stable and line-oriented so a one-word edit is a one-line diff.
 */
import mammoth from 'mammoth';
import TurndownService from 'turndown';

import { assetName, ConversionError, type Asset, type ConvertOptions } from './core';

/** Word's "Title" style is the document's top heading in practice. */
const STYLE_MAP = ["p[style-name='Title'] => h1:fresh"];

export async function docxToMarkdown(
  data: Uint8Array,
  options: ConvertOptions,
): Promise<{ markdown: string; assets: Asset[] }> {
  const assets = new Map<string, Asset>();
  const convertImage = mammoth.images.imgElement(async (image) => {
    const bytes = new Uint8Array(await image.readAsArrayBuffer());
    const name = assetName(bytes, image.contentType);
    if (options.images === 'omit') return { src: `#${name.split('.')[0] ?? name}` };
    assets.set(name, { name, data: bytes });
    return { src: `${options.assetsLink}/${name}` };
  });

  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(data.buffer, data.byteOffset, data.byteLength) },
      { styleMap: STYLE_MAP, convertImage, externalFileAccess: false },
    );
    html = result.value;
  } catch (error) {
    throw new ConversionError(`not a readable .docx: ${errorMessage(error)}`, { cause: error });
  }
  return { markdown: turndown().turndown(html), assets: [...assets.values()] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    // A backslash, not two trailing spaces: invisible whitespace makes diffs lie.
    br: '\\',
  });

  // Text like "<b>" is text, not HTML for the renderer.
  const escape = service.escape.bind(service);
  service.escape = (text) => escape(text).replace(/</g, '\\<');

  // mammoth emits footnote/endnote references as <sup><a>…</a></sup>; keep them as HTML.
  service.keep(['sup', 'sub']);

  service.addRule('strikethrough', {
    filter: ['s', 'del'],
    replacement: (content) => (content.trim() === '' ? content : `~~${content}~~`),
  });

  // Links to bookmarks inside the document (tables of contents, cross-references)
  // point at ids Word regenerates freely; they would only add diff noise.
  service.addRule('internalLink', {
    filter: (node) => node.nodeName === 'A' && (node.getAttribute('href') ?? '').startsWith('#'),
    replacement: (content) => content,
  });

  // One space after the marker, nested content indented to the marker's width.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = '- ';
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? '1');
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, `\n${' '.repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '');
    },
  });

  // GFM tables. Cells are not padded to a common width: one longer cell would
  // otherwise re-indent its whole column and turn a small edit into a big diff.
  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => `\n\n${tableToMarkdown(node, service)}\n\n`,
  });

  return service;
}

function childElements(node: Element, names: readonly string[]): Element[] {
  return Array.from(node.children).filter((child) => names.includes(child.nodeName));
}

function tableToMarkdown(table: HTMLElement, service: TurndownService): string {
  const rows = childElements(table, ['TR', 'THEAD', 'TBODY', 'TFOOT']).flatMap((child) =>
    child.nodeName === 'TR' ? [child] : childElements(child, ['TR']),
  );

  // Merged cells keep the grid rectangular: the merged area is filled with empty cells.
  const grid: string[][] = [];
  const spanning: number[] = []; // rows each column is still covered by a rowspan from above
  for (const row of rows) {
    const cells: string[] = [];
    let column = 0;
    const skipSpanned = () => {
      while ((spanning[column] ?? 0) > 0) {
        spanning[column] = (spanning[column] ?? 1) - 1;
        cells[column++] = '';
      }
    };
    for (const cell of childElements(row, ['TD', 'TH'])) {
      skipSpanned();
      const colspan = Math.max(1, Number(cell.getAttribute('colspan') ?? '1') || 1);
      const rowspan = Math.max(1, Number(cell.getAttribute('rowspan') ?? '1') || 1);
      for (let offset = 0; offset < colspan; offset++) {
        cells[column] = offset === 0 ? cellToMarkdown(cell, service) : '';
        if (rowspan > 1) spanning[column] = rowspan - 1;
        column++;
      }
    }
    skipSpanned();
    grid.push(cells);
  }

  const width = Math.max(1, ...grid.map((cells) => cells.length));
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`.replace(
      /\s+\|/g,
      ' |',
    );
  const [head = [], ...body] = grid;
  return [line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
}

function cellToMarkdown(cell: Element, service: TurndownService): string {
  return service
    .turndown(cell.innerHTML)
    .trim()
    .replace(/\s*\n\s*/g, '<br>')
    .replace(/\|/g, '\\|');
}
