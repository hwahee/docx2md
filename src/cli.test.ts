import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { CONFIG_FILE } from './config';
import { FORMAT_VERSION, header } from './layout';
import { docx, p, r } from './testing/docx';
import { project, type Project } from './testing/project';

const CLI = join(import.meta.dir, 'cli.ts');

let dir: Project;
beforeEach(async () => {
  dir = await project();
});
afterEach(async () => {
  await dir.dispose();
});

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['bun', CLI, ...args], { cwd: dir.root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe('docx2md', () => {
  test('build is the default; check passes after it and fails once a source changes', async () => {
    await dir.write('plan.docx', docx({ body: p(r('one')) }));

    const built = await cli();
    expect(built).toMatchObject({ code: 0, stdout: 'updated plan.md (from plan.docx)\n' });
    expect((await cli('check')).code).toBe(0);

    await dir.write('plan.docx', docx({ body: p(r('two')) }));
    const checked = await cli('check');
    expect(checked.code).toBe(1);
    expect(checked.stdout).toBe('stale plan.md (from plan.docx)\n');
    expect(checked.stderr).toContain('docx2md build');
  });

  test('check points at migrate when the output format changed', async () => {
    await dir.write('plan.docx', docx({ body: p(r('one')) }));
    await dir.write('plan.md', `${header('plan.docx', FORMAT_VERSION - 1)}\nold\n`);

    const checked = await cli('check');
    expect(checked.code).toBe(1);
    expect(checked.stdout).toContain(`output format ${FORMAT_VERSION - 1} → ${FORMAT_VERSION}`);
    expect(checked.stderr).toContain('docx2md migrate');
  });

  test('flags reach the options', async () => {
    await dir.write('a/x.docx', docx({ body: p(r('x')) }));
    await dir.write('b/y.docx', docx({ body: p(r('y')) }));
    expect((await cli('build', '--exclude', 'b/**', '-o', 'md')).code).toBe(0);
    expect((await dir.files()).filter((f) => f.endsWith('.md'))).toEqual(['md/a/x.md']);
  });

  test('a failed conversion exits 1', async () => {
    await dir.write('bad.docx', 'nope');
    const result = await cli();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('failed bad.docx');
  });

  test.each([
    [['convert'], 'unknown command "convert"'],
    [['build', 'extra'], 'unexpected argument "extra"'],
    [['--images', 'inline'], '"images" must be one of'],
    [['--nope'], "Unknown option '--nope'"],
  ])('%j is a usage error (exit 2)', async (args, message) => {
    const result = await cli(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  test('an invalid config file is a usage error', async () => {
    await dir.write(CONFIG_FILE, JSON.stringify({ outdir: 'md' }));
    const result = await cli();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown option "outdir"');
  });

  test('--help and --version', async () => {
    expect((await cli('--help')).stdout).toContain('Usage: docx2md');
    expect((await cli('--version')).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
