/**
 * Convert facade — the single import point for turning .docx bytes into
 * Markdown (see ./core.ts for the contract).
 *
 *   const { markdown, assets } = await convertDocx(bytes, {
 *     images: 'extract',
 *     assetsLink: 'plan.assets',
 *   });
 */
import { normalizeMarkdown, type Conversion, type ConvertOptions } from './core';
import { docxToMarkdown } from './mammoth-adapter';

export { ASSET_NAME, ConversionError, IMAGE_MODES, type Conversion, type ImageMode } from './core';

export async function convertDocx(data: Uint8Array, options: ConvertOptions): Promise<Conversion> {
  const { markdown, assets } = await docxToMarkdown(data, options);
  return {
    markdown: normalizeMarkdown(markdown),
    assets: [...assets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}
