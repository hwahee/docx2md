import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { project, type Project } from './testing/project';
import { CONFIG_FILE, ConfigError, loadOptions, parseOptions } from './config';

let dir: Project;
beforeEach(async () => {
  dir = await project();
});
afterEach(async () => {
  await dir.dispose();
});

describe('loadOptions', () => {
  test('defaults: every .docx, Markdown next to it, images extracted', async () => {
    expect(await loadOptions(dir.root, {})).toEqual({
      include: ['**/*.docx'],
      exclude: [],
      outDir: undefined,
      images: 'extract',
    });
  });

  test('the config file is read, and a flag replaces the same key', async () => {
    await dir.write(
      CONFIG_FILE,
      JSON.stringify({ include: ['docs/**/*.docx'], exclude: ['docs/drafts/**'], outDir: './md/' }),
    );
    expect(await loadOptions(dir.root, { exclude: ['docs/old/**'] })).toEqual({
      include: ['docs/**/*.docx'],
      exclude: ['docs/old/**'],
      outDir: 'md',
      images: 'extract',
    });
  });

  test('an explicit config file must exist', async () => {
    const attempt = loadOptions(dir.root, {}, join(dir.root, 'missing.json'));
    await expect(attempt).rejects.toBeInstanceOf(ConfigError);
  });

  test('broken JSON is a ConfigError naming the file', async () => {
    await dir.write(CONFIG_FILE, '{ include: ');
    await expect(loadOptions(dir.root, {})).rejects.toThrow(CONFIG_FILE);
  });
});

describe('parseOptions', () => {
  test.each([
    [{ includes: ['**/*.docx'] }, 'unknown option "includes"'],
    [{ include: '**/*.docx' }, '"include" must be an array'],
    [{ exclude: [''] }, '"exclude" must be an array'],
    [{ images: 'inline' }, '"images" must be one of'],
    [{ outDir: '../elsewhere' }, '"outDir" must be a path inside the project'],
    [{ outDir: '/tmp/md' }, '"outDir" must be a path inside the project'],
    [[], 'must be a JSON object'],
  ])('%j is rejected', (input, message) => {
    expect(() => parseOptions(input, 'test')).toThrow(message);
  });

  test('outDir "." means next to the source', () => {
    expect(parseOptions({ outDir: '.' }, 'test')).toEqual({ outDir: undefined });
  });
});
