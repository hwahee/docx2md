/**
 * The git-aware commands.
 *
 * `staged` (pre-commit hook) converts the staged .docx files and stages their
 * Markdown, so a commit always carries the .docx and its mirror together.
 * Sources are read from the git index, not the working tree: the Markdown
 * matches exactly what is being committed even if the .docx has changed again
 * since `git add`.
 *
 * `migrate` handles a docx2md update that changes the output format. It
 * regenerates the committed documents and stages only that, so the format
 * change gets a commit of its own. Without it, the first document edit after
 * the update would carry the whole format change in its diff.
 */
import { join } from 'node:path';

import type { Options } from './config';
import { FORMAT_VERSION, outputsFor, parseHeader } from './layout';
import { sourceMatcher } from './sources';
import { removeSource, syncSource, type Outcome } from './sync';

export async function syncStaged(root: string, options: Options): Promise<Outcome[]> {
  const isSource = sourceMatcher(options);
  const outcomes: Outcome[] = [];
  for (const { status, path } of await stagedChanges(root)) {
    if (!isSource(path)) continue;
    if (status === 'D') {
      const outcome = await removeSource(root, options, path, true);
      if (outcome !== undefined) outcomes.push(outcome);
      continue;
    }
    const committed = await committedFormat(root, outputsFor(path, options.outDir).markdown);
    if (committed !== undefined && committed !== FORMAT_VERSION) {
      outcomes.push({
        kind: 'failed',
        source: path,
        message:
          `its committed Markdown uses output format ${committed}, this docx2md writes format ${FORMAT_VERSION}. ` +
          'Run `docx2md migrate` and commit that first, so this commit shows only document changes.',
      });
      continue;
    }
    const data = await git(root, ['cat-file', 'blob', `:./${path}`]);
    const outcome = await syncSource(root, options, path, data, true);
    if (outcome !== undefined) outcomes.push(outcome);
  }
  await stage(root, outcomes);
  return outcomes;
}

/**
 * Regenerates the Markdown of every committed source and stages it. Refuses
 * while any selected .docx differs from HEAD: those edits would end up in the
 * format-change commit.
 */
export async function migrate(root: string, options: Options): Promise<Outcome[]> {
  const isSource = sourceMatcher(options);
  const modified = (
    await gitLines(root, ['diff', '--name-only', '--relative', '-z', 'HEAD'])
  ).filter(isSource);
  if (modified.length > 0) {
    throw new Error(
      `these .docx files differ from HEAD: ${modified.join(', ')}. ` +
        'Commit or stash them first (git stash), then run migrate again.',
    );
  }
  const outcomes: Outcome[] = [];
  for (const source of (await gitLines(root, ['ls-files', '-z'])).filter(isSource)) {
    const data = await Bun.file(join(root, source)).bytes();
    const outcome = await syncSource(root, options, source, data, true);
    if (outcome !== undefined) outcomes.push(outcome);
  }
  await stage(root, outcomes);
  return outcomes;
}

/** Stages what the outcomes wrote and deleted; a failed source stages nothing. */
async function stage(root: string, outcomes: readonly Outcome[]): Promise<void> {
  const changes = outcomes.flatMap((o) => (o.kind === 'failed' ? [] : o.changes));
  const added = changes.filter((c) => c.kind === 'write').map((c) => c.path);
  const deleted = changes.filter((c) => c.kind === 'delete').map((c) => c.path);
  if (added.length > 0) await git(root, ['add', '--', ...added]);
  // A deleted asset may never have been committed; --ignore-unmatch keeps that from failing.
  if (deleted.length > 0) {
    await git(root, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...deleted]);
  }
}

/** The output format of a Markdown file as committed in HEAD; `undefined` if there is none. */
async function committedFormat(root: string, markdown: string): Promise<number | undefined> {
  try {
    const text = new TextDecoder().decode(
      await git(root, ['cat-file', 'blob', `HEAD:./${markdown}`]),
    );
    return parseHeader(text)?.format;
  } catch {
    return undefined; // not committed (or no commit yet)
  }
}

/** Staged additions, modifications and deletions, relative to `root`. Renames count as delete + add. */
async function stagedChanges(root: string): Promise<{ status: string; path: string }[]> {
  const fields = await gitLines(root, [
    'diff',
    '--cached',
    '--name-status',
    '--no-renames',
    '--relative',
    '-z',
  ]);
  const changes: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? '';
    const path = fields[i + 1] ?? '';
    if (/^[AMTD]$/.test(status)) changes.push({ status, path });
  }
  return changes;
}

/** A `-z` command's output, split into its fields. */
async function gitLines(root: string, args: readonly string[]): Promise<string[]> {
  const output = new TextDecoder().decode(await git(root, args));
  return output.split('\0').filter((field) => field !== '');
}

async function git(root: string, args: readonly string[]): Promise<Uint8Array> {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args[0] ?? ''} failed: ${stderr.trim()}`);
  return stdout;
}
