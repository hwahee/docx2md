#!/usr/bin/env bun
/**
 * docx2md — mirrors .docx files as Markdown so their changes can be diffed in git.
 *
 * The .docx stays the source of truth; the Markdown is a generated view of it.
 * Exit codes: 0 = done, 1 = a conversion failed or `check` found stale files,
 * 2 = bad usage or configuration.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pkg from '../package.json' with { type: 'json' };
import { CONFIG_FILE, ConfigError, loadOptions, type Options } from './config';
import { migrate, syncStaged } from './git';
import { FORMAT_VERSION, outputsFor } from './layout';
import { syncAll, type Outcome } from './sync';
import { startWatch } from './watch';

const USAGE = `Usage: docx2md [command] [options]

Commands:
  build    Convert every selected .docx and remove orphaned Markdown (default)
  watch    build, then keep converting as files change (Ctrl+C to stop)
  check    Change nothing; exit 1 if any Markdown is missing or out of date (CI)
  staged   Convert the staged .docx files and stage their Markdown (pre-commit)
  migrate  After a docx2md update that changed the output format: regenerate
           the committed documents and stage only that, for a commit of its own

Options:
  -i, --include <glob>   Select sources (repeatable; default "**/*.docx")
  -e, --exclude <glob>   Skip sources (repeatable)
  -o, --out-dir <dir>    Write Markdown under <dir>, mirroring the source tree
                         (default: next to each .docx)
      --images <mode>    extract = save images next to the Markdown (default)
                         omit    = link only their content hash, no image files
  -c, --config <file>    Config file (default: ./${CONFIG_FILE} if present)
  -h, --help             Show this help
  -v, --version          Show the version

A flag replaces the same key of the config file. node_modules, hidden folders
and Word lock files (~$*.docx) are always skipped.`;

const COMMANDS = ['build', 'watch', 'check', 'staged', 'migrate'] as const;
type Command = (typeof COMMANDS)[number];

async function main(argv: readonly string[]): Promise<number> {
  let command: Command;
  let options: Options;
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        include: { type: 'string', multiple: true, short: 'i' },
        exclude: { type: 'string', multiple: true, short: 'e' },
        'out-dir': { type: 'string', short: 'o' },
        images: { type: 'string' },
        config: { type: 'string', short: 'c' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
    if (values.help) {
      console.log(USAGE);
      return 0;
    }
    if (values.version) {
      console.log(pkg.version);
      return 0;
    }
    const [name = 'build', ...rest] = positionals;
    if (!COMMANDS.includes(name as Command)) throw new ConfigError(`unknown command "${name}"`);
    if (rest.length > 0) throw new ConfigError(`unexpected argument "${rest[0] ?? ''}"`);
    command = name as Command;
    options = await loadOptions(
      process.cwd(),
      {
        include: values.include,
        exclude: values.exclude,
        outDir: values['out-dir'],
        images: values.images as Options['images'] | undefined,
      },
      values.config === undefined ? undefined : resolve(values.config),
    );
  } catch (error) {
    console.error(`docx2md: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }

  try {
    return await run(command, process.cwd(), options);
  } catch (error) {
    console.error(`docx2md: ${(error as Error).message}`);
    return 1;
  }
}

async function run(command: Command, root: string, options: Options): Promise<number> {
  switch (command) {
    case 'build':
      return report(await syncAll(root, options, { write: true }), options);
    case 'check': {
      const outcomes = await syncAll(root, options, { write: false });
      const code = report(outcomes, options, { dryRun: true });
      if (outcomes.some((outcome) => 'previousFormat' in outcome)) {
        console.error(
          'docx2md: the output format changed — run `docx2md migrate` and commit it on its own.',
        );
      } else if (outcomes.some((outcome) => outcome.kind !== 'failed')) {
        console.error(
          'docx2md: Markdown is out of date — run `docx2md build` and commit the result.',
        );
      }
      return code;
    }
    case 'staged':
      return report(await syncStaged(root, options), options);
    case 'migrate': {
      const outcomes = await migrate(root, options);
      const code = report(outcomes, options);
      if (code === 0 && outcomes.length > 0) {
        console.log(
          'docx2md: staged; commit it on its own, e.g. git commit -m "docx2md: regenerate"',
        );
      }
      return code;
    }
    case 'watch': {
      const watcher = startWatch(root, options, (outcomes) =>
        report(outcomes, options, { time: true }),
      );
      await watcher.ready;
      console.log(`docx2md: watching ${root} (Ctrl+C to stop)`);
      await new Promise<void>((done) => {
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      });
      watcher.close();
      return 0;
    }
  }
}

/** Prints one line per outcome; returns the exit code they amount to. */
function report(
  outcomes: readonly Outcome[],
  options: Options,
  style: { dryRun?: boolean; time?: boolean } = {},
): number {
  const stamp = style.time ? `[${new Date().toLocaleTimeString('en-GB')}] ` : '';
  let code = 0;
  for (const outcome of outcomes) {
    const markdown = outputsFor(outcome.source, options.outDir).markdown;
    switch (outcome.kind) {
      case 'updated': {
        const format =
          outcome.previousFormat === undefined
            ? ''
            : `; output format ${outcome.previousFormat} → ${FORMAT_VERSION}`;
        console.log(
          `${stamp}${style.dryRun ? 'stale' : 'updated'} ${markdown} (from ${outcome.source}${format})`,
        );
        code = style.dryRun ? 1 : code;
        break;
      }
      case 'removed': {
        const removed = outcome.changes[0]?.path ?? markdown;
        console.log(
          `${stamp}${style.dryRun ? 'orphan' : 'removed'} ${removed} (was generated from ${outcome.source})`,
        );
        code = style.dryRun ? 1 : code;
        break;
      }
      case 'failed':
        console.error(`${stamp}failed ${outcome.source}: ${outcome.message}`);
        code = 1;
        break;
    }
  }
  return code;
}

process.exitCode = await main(Bun.argv.slice(2));
