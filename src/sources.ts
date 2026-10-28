/**
 * Which files are sources, and walking the project to find them.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface Selection {
  /** Globs (relative to the root) a source must match at least one of. */
  readonly include: readonly string[];
  /** Globs a source must match none of. */
  readonly exclude: readonly string[];
}

/**
 * Never sources, whatever the selection says: Word's lock files (`~$name.docx`,
 * present while a document is open) are not documents.
 */
function isLockFile(path: string): boolean {
  return /(^|\/)~\$[^/]*$/.test(path);
}

export function sourceMatcher(selection: Selection): (path: string) => boolean {
  const compile = (patterns: readonly string[]) =>
    patterns.map((pattern) => new Bun.Glob(pattern.replace(/^\.\//, '')));
  const include = compile(selection.include);
  const exclude = compile(selection.exclude);
  return (path) =>
    !isLockFile(path) &&
    include.some((glob) => glob.match(path)) &&
    !exclude.some((glob) => glob.match(path));
}

/**
 * Directories never walked into: dependencies and hidden directories (`.git`,
 * editor and tool state). Pruning them here is what keeps a scan fast.
 */
export function isSkippedDirectory(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.');
}

/** Every file under `root` (outside skipped directories) as a sorted, `/`-separated relative path. */
export async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (relative: string) => {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  await visit('');
  return files.sort();
}
