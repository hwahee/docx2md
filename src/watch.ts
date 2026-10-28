/**
 * `watch` — keeps the Markdown mirror current while documents are edited.
 *
 * Every file event just schedules a full sync (debounced); the sync itself
 * skips sources whose size and mtime have not changed. That makes renames,
 * moved folders and editors' save dances (write a temp file, rename it over
 * the original) all the same case, with no per-event bookkeeping to get wrong.
 */
import { watch as watchFiles } from 'node:fs';

import type { Options } from './config';
import { isSkippedDirectory } from './sources';
import { syncAll, type Outcome } from './sync';

/** Long enough to let a save that is several file operations finish first. */
const DEBOUNCE_MS = 300;
/** A source that failed is often still being written; try again shortly, a few times. */
const RETRY_MS = 1000;
const MAX_RETRIES = 3;

export interface Watcher {
  /** Resolves once the initial sync is done and events are being watched. */
  readonly ready: Promise<void>;
  close(): void;
}

export function startWatch(
  root: string,
  options: Options,
  report: (outcomes: Outcome[]) => void,
): Watcher {
  const seen = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let retries = 0;
  let closed = false;

  const run = async () => {
    let outcomes: Outcome[];
    try {
      outcomes = await syncAll(root, options, { write: true, seen });
    } catch (error) {
      outcomes = [{ kind: 'failed', source: root, message: (error as Error).message }];
    }
    report(outcomes);
    const failed = outcomes.some((outcome) => outcome.kind === 'failed');
    retries = failed ? retries + 1 : 0;
    if (failed && retries <= MAX_RETRIES) schedule(RETRY_MS);
  };

  const sync = (): Promise<void> => {
    timer = undefined;
    if (closed) return Promise.resolve();
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = undefined;
      if (again) {
        again = false;
        schedule(DEBOUNCE_MS);
      }
    });
    return running;
  };

  const schedule = (delay: number) => {
    if (closed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(sync, delay);
  };

  const watcher = watchFiles(root, { recursive: true }, (_event, filename) => {
    if (filename !== null && isOwnOrIgnored(filename.toString())) return;
    retries = 0;
    schedule(DEBOUNCE_MS);
  });

  const ready = sync();

  return {
    ready,
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
    },
  };
}

/** Our own writes (Markdown, assets) and skipped directories must not trigger another sync. */
function isOwnOrIgnored(filename: string): boolean {
  const parts = filename.split(/[\\/]/);
  if (parts.slice(0, -1).some(isSkippedDirectory)) return true;
  if (parts.some((part) => part.endsWith('.assets'))) return true;
  return filename.endsWith('.md');
}
