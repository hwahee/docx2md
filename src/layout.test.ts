import { describe, expect, test } from 'bun:test';

import { assetsOf, FORMAT_VERSION, header, outputsFor, parseHeader } from './layout';

describe('outputsFor', () => {
  test('next to the source by default', () => {
    expect(outputsFor('docs/plan.docx', undefined)).toEqual({
      markdown: 'docs/plan.md',
      assets: 'docs/plan.assets',
      assetsLink: 'plan.assets',
    });
  });

  test('under outDir, mirroring the source tree', () => {
    expect(outputsFor('docs/plan.docx', 'mirror').markdown).toBe('mirror/docs/plan.md');
    expect(outputsFor('docs/plan.docx', 'mirror').assets).toBe('mirror/docs/plan.assets');
  });

  test('the assets link survives spaces and parentheses, and keeps Hangul readable', () => {
    expect(outputsFor('기획서 (초안).docx', undefined).assetsLink).toBe(
      '기획서%20%28초안%29.assets',
    );
  });

  test('assetsOf finds the assets folder of a generated file', () => {
    expect(assetsOf('docs/plan.md')).toBe(outputsFor('docs/plan.docx', undefined).assets);
  });
});

describe('header', () => {
  test('round-trips the source path', () => {
    for (const source of ['plan.docx', 'docs/기획 "v2".docx', 'a\\b.docx']) {
      expect(parseHeader(`${header(source)}\n# Title\n`)).toEqual({
        source,
        format: FORMAT_VERSION,
      });
    }
  });

  test('a source name cannot close the comment', () => {
    const line = header('x -->.docx');
    expect(line.indexOf('-->')).toBe(line.length - '-->\n'.length);
    expect(parseHeader(line)?.source).toBe('x -->.docx');
  });

  test('records which output format wrote the file', () => {
    expect(parseHeader(header('plan.docx', 7))?.format).toBe(7);
  });

  test('files without the header are not generated', () => {
    expect(parseHeader('# Hand-written\n')).toBeUndefined();
    expect(parseHeader(`\n${header('plan.docx')}`)).toBeUndefined();
  });
});
