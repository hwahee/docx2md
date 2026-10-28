/**
 * Guards FORMAT_VERSION (src/layout.ts).
 *
 * A fixed document that uses every supported feature is converted, and the
 * hash of the result must be the one recorded for the current format version.
 * When this fails, the output changed — by a rule edit or a dependency
 * upgrade — and downstream repositories will see every generated file change:
 *
 *   1. Bump FORMAT_VERSION.
 *   2. Add `<new version>: '<hash from the failure>'` below (never edit an old entry).
 *   3. Describe the change in README.md, "출력 형식 버전".
 */
import { expect, test } from 'bun:test';

import { FORMAT_VERSION } from '../layout';
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
import { convertDocx } from './index';

const HASHES: Readonly<Record<number, string>> = {
  1: 'eee0ade235b11e6b4505edc0d7d770336668752243cb8451fa37a5a9b62c6590',
};

const corpus = docx({
  styles: [
    paragraphStyle('a3', 'Title'),
    paragraphStyle('1', 'heading 1'),
    paragraphStyle('2', 'heading 2'),
    paragraphStyle('3', 'heading 3'),
  ].join(''),
  numbering: numbering(1, 'bullet') + numbering(2, 'decimal'),
  images: [{ id: 'img', png: png(7) }],
  links: [{ id: 'web', url: 'https://example.com/path?q=1' }],
  body: [
    p(r('기획서'), { style: 'a3' }),
    p(anchorLink('_Toc1', r('1. 개요'))),
    p(r('개요'), { style: '1' }),
    p(
      r('본문 ') +
        r('굵게', { bold: true }) +
        r(' ') +
        r('기울임', { italic: true }) +
        r(' ') +
        r('취소', { strike: true }) +
        r(' * _ # | ` [ ] < > \\'),
    ),
    p(r('줄') + br + r('바꿈')),
    p(link('web', r('링크'))),
    p(r('목록'), { style: '2' }),
    p(r('a'), { list: [1, 0] }),
    p(r('a.1'), { list: [1, 1] }),
    p(r('a.1.1'), { list: [1, 2] }),
    p(r('b'), { list: [1, 0] }),
    p(r('하나'), { list: [2, 0] }),
    p(r('둘'), { list: [2, 0] }),
    p(r('표'), { style: '3' }),
    table([
      [p(r('항목')), p(r('값 | 단위'))],
      [p(r('첫째')) + p(r('둘째')), p(r('1'))],
      [{ content: p(r('병합')), span: 2 }],
    ]),
    p(image('img', '그림')),
    p(''),
  ].join(''),
});

test(`output format ${FORMAT_VERSION} is unchanged`, async () => {
  const { markdown } = await convertDocx(corpus, { images: 'extract', assetsLink: 'x.assets' });
  const hash = new Bun.CryptoHasher('sha256').update(markdown).digest('hex');
  expect(hash).toBe(HASHES[FORMAT_VERSION] ?? '(no hash recorded for this format version)');
});
