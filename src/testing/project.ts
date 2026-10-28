/**
 * A throwaway project directory for tests that touch the real file system.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Project {
  readonly root: string;
  write(path: string, data: string | Uint8Array): Promise<void>;
  /** The file's text, or `undefined` if it does not exist. */
  read(path: string): Promise<string | undefined>;
  remove(path: string): Promise<void>;
  /** Every file in the project, relative and sorted (hidden folders like .git left out). */
  files(): Promise<string[]>;
  dispose(): Promise<void>;
}

export async function project(): Promise<Project> {
  const root = await mkdtemp(join(tmpdir(), 'docx2md-'));
  return {
    root,
    async write(path, data) {
      await Bun.write(join(root, path), data);
    },
    async read(path) {
      const file = Bun.file(join(root, path));
      return (await file.exists()) ? file.text() : undefined;
    },
    async remove(path) {
      await rm(join(root, path), { recursive: true, force: true });
    },
    async files() {
      const glob = new Bun.Glob('**/*');
      return (await Array.fromAsync(glob.scan({ cwd: root })))
        .map((p) => p.replace(/\\/g, '/'))
        .sort();
    },
    async dispose() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
