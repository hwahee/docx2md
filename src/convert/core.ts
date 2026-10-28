/**
 * Convert facade — public contract and the library-independent half of a
 * conversion.
 *
 * Callers depend only on what is declared here and on `convertDocx` from
 * ./index.ts. The libraries that read .docx and write Markdown live behind
 * ./mammoth-adapter.ts and can be replaced without touching callers. Anything
 * that must stay the same across such a swap (asset names, whitespace
 * normalization) lives here, not in the adapter.
 */

/**
 * `extract` — images are returned as assets and linked from the Markdown.
 * `omit` — images become a broken link that names the image's content hash,
 * so a changed image still shows up in a diff without a binary file in git.
 */
export const IMAGE_MODES = ['extract', 'omit'] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

export interface ConvertOptions {
  readonly images: ImageMode;
  /** Link to the assets folder as written in the Markdown, relative to the .md file. */
  readonly assetsLink: string;
}

/** An extracted image; `name` is derived from its content, so unchanged images keep their file. */
export interface Asset {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface Conversion {
  readonly markdown: string;
  /** Sorted by name, without duplicates. Always empty in `omit` mode. */
  readonly assets: readonly Asset[];
}

/** The input could not be read as a .docx (corrupt, not a zip, or still being written). */
export class ConversionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConversionError';
  }
}

/** The exact pattern of asset names — anything else in an assets folder is not ours. */
export const ASSET_NAME = /^[0-9a-f]{16}\.[a-z0-9]+$/;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf',
};

/** `<sha256 prefix>.<ext>` — the same bytes always get the same name. */
export function assetName(data: Uint8Array, contentType: string): string {
  const hash = new Bun.CryptoHasher('sha256').update(data).digest('hex').slice(0, 16);
  const subtype = contentType.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? '';
  const extension = EXTENSIONS[contentType] ?? (subtype || 'bin');
  return `${hash}.${extension}`;
}

/**
 * The same document must always produce the same bytes, whatever platform
 * or library version wrote the intermediate text.
 */
export function normalizeMarkdown(markdown: string): string {
  const body = markdown
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body === '' ? '' : `${body}\n`;
}
