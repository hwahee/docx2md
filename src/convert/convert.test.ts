import { describe, expect, test } from 'bun:test';

import {
  anchorLink,
  br,
  docx,
  image,
  link,
  numbering,
  p,
  paragraphStyle,
  png,
  r,
  table,
} from '../testing/docx';
import { ConversionError, convertDocx } from './index';

const extract = { images: 'extract', assetsLink: 'plan.assets' } as const;

async function markdownOf(parts: Parameters<typeof docx>[0]): Promise<string> {
  return (await convertDocx(docx(parts), extract)).markdown;
}

describe('convertDocx', () => {
  test('headings come from the style name Word stores, whatever the UI language', async () => {
    // Korean Word names its style ids "1", "2", … but stores the English style names.
    const markdown = await markdownOf({
      styles:
        paragraphStyle('a3', 'Title') +
        paragraphStyle('1', 'heading 1') +
        paragraphStyle('2', 'heading 2'),
      body:
        p(r('문서'), { style: 'a3' }) + p(r('개요'), { style: '1' }) + p(r('세부'), { style: '2' }),
    });
    expect(markdown).toBe('# 문서\n\n# 개요\n\n## 세부\n');
  });

  test('emphasis is kept, Markdown syntax in text is escaped', async () => {
    const markdown = await markdownOf({
      body: p(
        r('a ') +
          r('bold', { bold: true }) +
          r(' ') +
          r('italic', { italic: true }) +
          r(' ') +
          r('gone', { strike: true }) +
          r(' *not* _emphasis_'),
      ),
    });
    expect(markdown).toBe('a **bold** _italic_ ~~gone~~ \\*not\\* \\_emphasis\\_\n');
  });

  test('a line break inside a paragraph is a visible backslash, not trailing spaces', async () => {
    expect(await markdownOf({ body: p(r('one') + br + r('two')) })).toBe('one\\\ntwo\n');
  });

  test('lists keep their kind and nesting', async () => {
    const markdown = await markdownOf({
      numbering: numbering(1, 'bullet') + numbering(2, 'decimal'),
      body: [
        p(r('a'), { list: [1, 0] }),
        p(r('a.1'), { list: [1, 1] }),
        p(r('b'), { list: [1, 0] }),
        p(r('between')),
        p(r('one'), { list: [2, 0] }),
        p(r('two'), { list: [2, 0] }),
        p(r('two.a'), { list: [2, 1] }),
      ].join(''),
    });
    expect(markdown).toBe('- a\n  - a.1\n- b\n\nbetween\n\n1. one\n2. two\n   1. two.a\n');
  });

  test('tables become GFM tables: first row is the header, merged cells keep the grid', async () => {
    const markdown = await markdownOf({
      body: table([
        [p(r('Name')), p(r('a | b'))],
        [p(r('first')) + p(r('second')), p(r('x'))],
        [{ content: p(r('merged')), span: 2 }],
      ]),
    });
    expect(markdown).toBe(
      ['| Name | a \\| b |', '| --- | --- |', '| first<br>second | x |', '| merged | |', ''].join(
        '\n',
      ),
    );
  });

  test('external links are kept, links to bookmarks (table of contents) become text', async () => {
    const markdown = await markdownOf({
      links: [{ id: 'l1', url: 'https://example.com/' }],
      body: p(anchorLink('_Toc123456', r('Overview'))) + p(link('l1', r('site'))),
    });
    expect(markdown).toBe('Overview\n\n[site](https://example.com/)\n');
  });

  test('images are extracted under content-hash names and linked', async () => {
    const bytes = docx({
      images: [
        { id: 'one', png: png(1) },
        { id: 'two', png: png(2) },
      ],
      body: p(image('two', 'second')) + p(image('one', 'first')) + p(image('two', 'again')),
    });
    const { markdown, assets } = await convertDocx(bytes, extract);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.name)).toEqual([...assets.map((a) => a.name)].sort());
    for (const asset of assets) expect(asset.name).toMatch(/^[0-9a-f]{16}\.png$/);
    const [first, second] = [png(1), png(2)].map(
      (data) => assets.find((asset) => Buffer.from(asset.data).equals(Buffer.from(data)))?.name,
    );
    expect(markdown).toBe(
      `![second](plan.assets/${second})\n\n![first](plan.assets/${first})\n\n![again](plan.assets/${second})\n`,
    );
  });

  test('omit mode writes no assets but still names each image by its content', async () => {
    const bytes = docx({ images: [{ id: 'one', png: png(1) }], body: p(image('one', 'chart')) });
    const extracted = await convertDocx(bytes, extract);
    const omitted = await convertDocx(bytes, { images: 'omit', assetsLink: 'plan.assets' });

    expect(omitted.assets).toEqual([]);
    const hash = extracted.assets[0]?.name.split('.')[0];
    expect(omitted.markdown).toBe(`![chart](#${hash})\n`);
  });

  test('the same document always gives the same output', async () => {
    const bytes = docx({ body: p(r('stable')) + table([[p(r('a'))], [p(r('b'))]]) });
    const first = await convertDocx(bytes, extract);
    const second = await convertDocx(bytes, extract);
    expect(second).toEqual(first);
  });

  test('an empty document is empty Markdown', async () => {
    expect(await markdownOf({ body: p('') })).toBe('');
  });

  test('bytes that are not a .docx fail with ConversionError', async () => {
    const attempt = convertDocx(new TextEncoder().encode('not a zip'), extract);
    await expect(attempt).rejects.toBeInstanceOf(ConversionError);
  });
});
