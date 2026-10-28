import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Options } from './config';
import { FORMAT_VERSION, header } from './layout';
import { syncAll } from './sync';
import { docx, image, p, png, r } from './testing/docx';
import { project, type Project } from './testing/project';

const defaults: Options = {
  include: ['**/*.docx'],
  exclude: [],
  outDir: undefined,
  images: 'extract',
};

let dir: Project;
beforeEach(async () => {
  dir = await project();
});
afterEach(async () => {
  await dir.dispose();
});

const build = (options: Partial<Options> = {}) =>
  syncAll(dir.root, { ...defaults, ...options }, { write: true });
const check = (options: Partial<Options> = {}) =>
  syncAll(dir.root, { ...defaults, ...options }, { write: false });

describe('syncAll', () => {
  test('writes a Markdown mirror with the header, then has nothing left to do', async () => {
    await dir.write('docs/plan.docx', docx({ body: p(r('Hello')) }));

    const outcomes = await build();
    expect(outcomes.map((o) => [o.kind, o.source])).toEqual([['updated', 'docs/plan.docx']]);
    expect(await dir.read('docs/plan.md')).toBe(`${header('docs/plan.docx')}\nHello\n`);

    expect(await build()).toEqual([]);
    expect(await check()).toEqual([]);
  });

  test('include and exclude select the sources; node_modules, hidden folders and lock files never count', async () => {
    const doc = docx({ body: p(r('x')) });
    for (const path of [
      'docs/a.docx',
      'docs/drafts/b.docx',
      'other/c.docx',
      'docs/~$a.docx',
      'node_modules/pkg/d.docx',
      '.cache/e.docx',
    ]) {
      await dir.write(path, doc);
    }

    await build({ include: ['docs/**/*.docx'], exclude: ['docs/drafts/**'] });
    expect((await dir.files()).filter((f) => f.endsWith('.md'))).toEqual(['docs/a.md']);
  });

  test('outDir mirrors the source tree, and moving it moves the files', async () => {
    await dir.write('docs/plan.docx', docx({ body: p(r('x')) }));
    await build({ outDir: 'md' });
    expect(await dir.read('md/docs/plan.md')).toContain('x');

    await build({ outDir: 'mirror' });
    expect(await dir.read('md/docs/plan.md')).toBeUndefined();
    expect(await dir.read('mirror/docs/plan.md')).toContain('x');
  });

  test('check reports stale and orphaned Markdown without changing anything', async () => {
    await dir.write('a.docx', docx({ body: p(r('one')) }));
    await dir.write('b.docx', docx({ body: p(r('two')) }));
    await build();
    await dir.write('a.docx', docx({ body: p(r('one, edited')) }));
    await dir.remove('b.docx');

    const before = await dir.files();
    const outcomes = await check();
    expect(outcomes.map((o) => [o.kind, o.source])).toEqual([
      ['updated', 'a.docx'],
      ['removed', 'b.docx'],
    ]);
    expect(await dir.files()).toEqual(before);
    expect(await dir.read('a.md')).toContain('one\n');
  });

  test('a deleted source takes its Markdown and images with it', async () => {
    await dir.write(
      'plan.docx',
      docx({ images: [{ id: 'i', png: png() }], body: p(image('i', 'x')) }),
    );
    await build();
    expect((await dir.files()).some((f) => f.startsWith('plan.assets/'))).toBe(true);

    await dir.remove('plan.docx');
    const outcomes = await build();
    expect(outcomes.map((o) => o.kind)).toEqual(['removed']);
    expect(await dir.files()).toEqual([]);
  });

  test('images that leave the document leave the assets folder; unknown files there stay', async () => {
    await dir.write(
      'plan.docx',
      docx({ images: [{ id: 'one', png: png(1) }], body: p(image('one', 'x')) }),
    );
    await build();
    const [first] = (await dir.files()).filter((f) => f.startsWith('plan.assets/'));
    await dir.write('plan.assets/notes.txt', 'mine');

    await dir.write(
      'plan.docx',
      docx({ images: [{ id: 'two', png: png(2) }], body: p(image('two', 'x')) }),
    );
    await build();
    const assets = (await dir.files()).filter((f) => f.startsWith('plan.assets/'));
    expect(assets).toHaveLength(2);
    expect(assets).toContain('plan.assets/notes.txt');
    expect(assets).not.toContain(first);
  });

  test('a hand-written Markdown file is never overwritten or deleted', async () => {
    await dir.write('README.md', '# Mine\n');
    await dir.write('README.docx', docx({ body: p(r('generated')) }));

    const outcomes = await build();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe('failed');
    expect(await dir.read('README.md')).toBe('# Mine\n');

    await dir.remove('README.docx');
    expect(await build()).toEqual([]);
    expect(await dir.read('README.md')).toBe('# Mine\n');
  });

  test('Markdown written by another output format is updated and says which format it had', async () => {
    await dir.write('plan.docx', docx({ body: p(r('x')) }));
    await dir.write('plan.md', `${header('plan.docx', FORMAT_VERSION - 1)}\nold rendering\n`);

    const [outcome] = await check();
    expect(outcome).toMatchObject({ kind: 'updated', previousFormat: FORMAT_VERSION - 1 });
    await build();
    expect(await dir.read('plan.md')).toBe(`${header('plan.docx')}\nx\n`);
  });

  test('a corrupt source fails alone and keeps its previous Markdown', async () => {
    await dir.write('good.docx', docx({ body: p(r('good')) }));
    await dir.write('bad.docx', docx({ body: p(r('before')) }));
    await build();
    await dir.write('bad.docx', 'half-written');

    const outcomes = await build();
    expect(outcomes.map((o) => [o.kind, o.source])).toEqual([['failed', 'bad.docx']]);
    expect(await dir.read('bad.md')).toContain('before');
  });
});
