import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Options } from './config';
import { migrate, syncStaged } from './git';
import { FORMAT_VERSION } from './layout';
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
  await git('init', '--quiet');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'test');
  await git('config', 'commit.gpgsign', 'false');
});
afterEach(async () => {
  await dir.dispose();
});

async function git(...args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd: dir.root, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
  return out;
}

const staged = async () => (await git('diff', '--cached', '--name-status')).trim().split('\n');

describe('syncStaged', () => {
  test('converts the staged version and stages its Markdown and images', async () => {
    await dir.write(
      'plan.docx',
      docx({ images: [{ id: 'i', png: png() }], body: p(r('staged')) + p(image('i', 'x')) }),
    );
    await git('add', 'plan.docx');
    // Edited again after `git add`: the commit still carries the staged version.
    await dir.write('plan.docx', docx({ body: p(r('working tree')) }));

    const outcomes = await syncStaged(dir.root, defaults);
    expect(outcomes.map((o) => [o.kind, o.source])).toEqual([['updated', 'plan.docx']]);
    expect(await dir.read('plan.md')).toContain('staged');
    const [asset] = (await dir.files()).filter((f) => f.startsWith('plan.assets/'));
    expect((await staged()).sort()).toEqual(['A\tplan.docx', 'A\tplan.md', `A\t${asset}`].sort());
  });

  test('leaves unstaged and unselected sources alone', async () => {
    await dir.write('notes/a.docx', docx({ body: p(r('a')) }));
    await dir.write('drafts/b.docx', docx({ body: p(r('b')) }));
    await dir.write('c.docx', docx({ body: p(r('c')) }));
    await git('add', 'notes/a.docx', 'drafts/b.docx');

    await syncStaged(dir.root, { ...defaults, exclude: ['drafts/**'] });
    expect((await dir.files()).filter((f) => f.endsWith('.md'))).toEqual(['notes/a.md']);
  });

  test('a staged deletion deletes and unstages the Markdown', async () => {
    await dir.write('plan.docx', docx({ body: p(r('x')) }));
    await git('add', 'plan.docx');
    await syncStaged(dir.root, defaults);
    await git('commit', '--quiet', '-m', 'add');

    await git('rm', '--quiet', 'plan.docx');
    const outcomes = await syncStaged(dir.root, defaults);
    expect(outcomes.map((o) => o.kind)).toEqual(['removed']);
    expect(await dir.read('plan.md')).toBeUndefined();
    expect((await staged()).sort()).toEqual(['D\tplan.docx', 'D\tplan.md']);
  });

  test('a rename moves the Markdown', async () => {
    await dir.write('old.docx', docx({ body: p(r('x')) }));
    await git('add', 'old.docx');
    await syncStaged(dir.root, defaults);
    await git('commit', '--quiet', '-m', 'add');

    await git('mv', 'old.docx', 'new.docx');
    await syncStaged(dir.root, defaults);
    expect(await dir.read('old.md')).toBeUndefined();
    expect(await dir.read('new.md')).toContain('x');
  });

  test('a failed conversion stages nothing', async () => {
    await dir.write('bad.docx', 'not a docx');
    await git('add', 'bad.docx');

    const outcomes = await syncStaged(dir.root, defaults);
    expect(outcomes.map((o) => o.kind)).toEqual(['failed']);
    expect(await staged()).toEqual(['A\tbad.docx']);
  });
});

describe('after an update that changed the output format', () => {
  /** A repository whose committed Markdown was written by the previous format. */
  async function committedWithOldFormat(): Promise<void> {
    await dir.write('a.docx', docx({ body: p(r('a')) }));
    await dir.write('b.docx', docx({ body: p(r('b')) }));
    await git('add', '.');
    await syncStaged(dir.root, defaults);
    for (const md of ['a.md', 'b.md']) {
      const text = (await dir.read(md)) ?? '';
      await dir.write(
        md,
        text.replace(`(format ${FORMAT_VERSION})`, `(format ${FORMAT_VERSION - 1})`),
      );
    }
    await git('add', '.');
    await git('commit', '--quiet', '-m', 'old format');
  }

  test('staged refuses to mix the format change into a document edit', async () => {
    await committedWithOldFormat();
    await dir.write('a.docx', docx({ body: p(r('a, edited')) }));
    await git('add', 'a.docx');

    const outcomes = await syncStaged(dir.root, defaults);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'failed', source: 'a.docx' });
    expect(outcomes[0]?.kind === 'failed' && outcomes[0].message).toContain('docx2md migrate');
    expect(await staged()).toEqual(['M\ta.docx']);
  });

  test('migrate refuses while a .docx differs from HEAD', async () => {
    await committedWithOldFormat();
    await dir.write('a.docx', docx({ body: p(r('a, edited')) }));
    await expect(migrate(dir.root, defaults)).rejects.toThrow('a.docx');
  });

  test('migrate stages only the regenerated Markdown; document edits work again after it', async () => {
    await committedWithOldFormat();

    const outcomes = await migrate(dir.root, defaults);
    expect(outcomes.map((o) => o.kind === 'updated' && o.previousFormat)).toEqual([
      FORMAT_VERSION - 1,
      FORMAT_VERSION - 1,
    ]);
    expect((await staged()).sort()).toEqual(['M\ta.md', 'M\tb.md']);
    await git('commit', '--quiet', '-m', 'docx2md: regenerate');

    await dir.write('a.docx', docx({ body: p(r('a, edited')) }));
    await git('add', 'a.docx');
    expect((await syncStaged(dir.root, defaults)).map((o) => o.kind)).toEqual(['updated']);
    expect(await dir.read('a.md')).toContain('a, edited');
  });
});
