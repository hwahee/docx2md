/**
 * Builds minimal but valid .docx files for tests, so each test states the
 * exact WordprocessingML it is about instead of depending on a binary fixture.
 *
 *   const bytes = docx({ body: p(r('Hello')) });
 */
import { strToU8, zipSync } from 'fflate';

const NS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface DocxParts {
  /** Children of `<w:body>`. */
  readonly body: string;
  /** Children of `<w:styles>`. */
  readonly styles?: string;
  /** Children of `<w:numbering>`. */
  readonly numbering?: string;
  /** Images, referenced from the body as `r:embed="<id>"`. */
  readonly images?: readonly { id: string; png: Uint8Array }[];
  /** External hyperlinks, referenced from the body as `r:id="<id>"`. */
  readonly links?: readonly { id: string; url: string }[];
}

export function docx(parts: DocxParts): Uint8Array {
  const rels = [
    parts.styles === undefined
      ? ''
      : `<Relationship Id="rStyles" Type="${REL}/styles" Target="styles.xml"/>`,
    parts.numbering === undefined
      ? ''
      : `<Relationship Id="rNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`,
    ...(parts.images ?? []).map(
      ({ id }) => `<Relationship Id="${id}" Type="${REL}/image" Target="media/${id}.png"/>`,
    ),
    ...(parts.links ?? []).map(
      ({ id, url }) =>
        `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${url}" TargetMode="External"/>`,
    ),
  ].join('');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    ),
    '_rels/.rels': xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rDoc" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    ),
    'word/_rels/document.xml.rels': xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    ),
    'word/document.xml': xml(`<w:document ${NS}><w:body>${parts.body}</w:body></w:document>`),
  };
  if (parts.styles !== undefined) {
    files['word/styles.xml'] = xml(`<w:styles ${NS}>${parts.styles}</w:styles>`);
  }
  if (parts.numbering !== undefined) {
    files['word/numbering.xml'] = xml(`<w:numbering ${NS}>${parts.numbering}</w:numbering>`);
  }
  for (const { id, png } of parts.images ?? []) files[`word/media/${id}.png`] = png;
  // A fixed timestamp keeps fixture bytes identical between runs.
  return zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') });
}

function xml(content: string): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A paragraph; `style` is a style id from `styles`, `list` puts it in a numbering. */
export function p(
  runs: string,
  options: { style?: string; list?: [numId: number, level: number] } = {},
): string {
  const props = [
    options.style === undefined ? '' : `<w:pStyle w:val="${options.style}"/>`,
    options.list === undefined
      ? ''
      : `<w:numPr><w:ilvl w:val="${options.list[1]}"/><w:numId w:val="${options.list[0]}"/></w:numPr>`,
  ].join('');
  return `<w:p>${props === '' ? '' : `<w:pPr>${props}</w:pPr>`}${runs}</w:p>`;
}

/** A run of text with optional emphasis. */
export function r(
  text: string,
  options: { bold?: boolean; italic?: boolean; strike?: boolean } = {},
): string {
  const props = [
    options.bold ? '<w:b/>' : '',
    options.italic ? '<w:i/>' : '',
    options.strike ? '<w:strike/>' : '',
  ].join('');
  return `<w:r>${props === '' ? '' : `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}

/** A line break inside a paragraph (Shift+Enter in Word). */
export const br = '<w:r><w:br/></w:r>';

/** A paragraph style; `name` is what Word stores whatever the UI language. */
export function paragraphStyle(id: string, name: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
}

/** A numbering definition `numId` whose every level uses `format` ("bullet" or "decimal"). */
export function numbering(numId: number, format: 'bullet' | 'decimal'): string {
  const levels = [0, 1, 2]
    .map(
      (level) =>
        `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${format === 'bullet' ? '•' : `%${level + 1}.`}"/></w:lvl>`,
    )
    .join('');
  return `<w:abstractNum w:abstractNumId="${numId}">${levels}</w:abstractNum><w:num w:numId="${numId}"><w:abstractNumId w:val="${numId}"/></w:num>`;
}

/** A table; each cell is the XML of its paragraphs. `merge` spans a cell over columns. */
export function table(
  rows: readonly (readonly (string | { content: string; span: number })[])[],
): string {
  const cell = (c: string | { content: string; span: number }) =>
    typeof c === 'string'
      ? `<w:tc>${c}</w:tc>`
      : `<w:tc><w:tcPr><w:gridSpan w:val="${c.span}"/></w:tcPr>${c.content}</w:tc>`;
  return `<w:tbl>${rows.map((row) => `<w:tr>${row.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
}

/** An external hyperlink around runs; `id` must be listed in `links`. */
export function link(id: string, runs: string): string {
  return `<w:hyperlink r:id="${id}">${runs}</w:hyperlink>`;
}

/** A link to a bookmark inside the document, like a table-of-contents entry. */
export function anchorLink(anchor: string, runs: string): string {
  return `<w:hyperlink w:anchor="${anchor}">${runs}</w:hyperlink>`;
}

/** An inline picture; `id` must be listed in `images`. */
export function image(id: string, alt: string): string {
  return (
    `<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture" descr="${escape(alt)}"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** A 1×1 PNG; different seeds give different bytes (trailing data after IEND). */
export function png(seed = 0): Uint8Array {
  const base = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );
  return new Uint8Array([...base, ...strToU8(`seed:${seed}`)]);
}
