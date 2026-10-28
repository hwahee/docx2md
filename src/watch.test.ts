import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

import type { Options } from './config';
import type { Outcome } from './sync';
import { docx, p, r } from './testing/docx';
import { project, type Project } from './testing/project';
import { startWatch, type Watcher } from './watch';

const defaults: Options = {
  include: ['**/*.docx'],
  exclude: [],
  outDir: undefined,
  images: 'extract',
};

let dir: Project;
let watcher: Watcher | undefined;
let reported: Outcome[];
beforeEach(async () => {
  dir = await project();
  reported = [];
});
afterEach(async () => {
  watcher?.close();
  await dir.dispose();
});

/** Polls until `condition` holds — file events arrive on the OS's schedule, not ours. */
async function eventually(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await Bun.sleep(50);
  }
}

async function start(): Promise<void> {
  watcher = startWatch(dir.root, defaults, (outcomes) => reported.push(...outcomes));
  await watcher.ready;
}

describe('startWatch', () => {
  test('converts what exists, then follows edits, new folders, renames and deletions', async () => {
    await dir.write('a.docx', docx({ body: p(r('first')) }));
    await start();
    expect(await dir.read('a.md')).toContain('first');

    await dir.write('a.docx', docx({ body: p(r('edited')) }));
    await eventually(async () => (await dir.read('a.md'))?.includes('edited') ?? false);

    await mkdir(join(dir.root, 'new/deep'), { recursive: true });
    await dir.write('new/deep/b.docx', docx({ body: p(r('b')) }));
    await eventually(async () => (await dir.read('new/deep/b.md')) !== undefined);

    await rename(join(dir.root, 'new'), join(dir.root, 'moved'));
    await eventually(async () => (await dir.read('moved/deep/b.md')) !== undefined);
    expect(await dir.read('new/deep/b.md')).toBeUndefined();

    await dir.remove('a.docx');
    await eventually(async () => (await dir.read('a.md')) === undefined);
  });

  test('a save that is still half-written fails, then recovers on the next event', async () => {
    await start();
    await dir.write('a.docx', 'half');
    await eventually(() => Promise.resolve(reported.some((o) => o.kind === 'failed')));

    await dir.write('a.docx', docx({ body: p(r('done')) }));
    await eventually(async () => (await dir.read('a.md'))?.includes('done') ?? false);
  });
});
