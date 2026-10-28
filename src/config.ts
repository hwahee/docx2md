/**
 * Options — every setting enters here, from the config file and the command
 * line, and is validated once before any file is touched.
 *
 * The config file is optional; a command-line flag replaces the same key of
 * the file (it does not merge with it).
 */
import { isAbsolute, join } from 'node:path';

import { IMAGE_MODES, type ImageMode } from './convert';

export interface Options {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Mirror tree root for the Markdown, relative to the project root. Unset = next to each .docx. */
  readonly outDir: string | undefined;
  readonly images: ImageMode;
}

export const CONFIG_FILE = 'docx2md.config.json';

const DEFAULTS: Options = {
  include: ['**/*.docx'],
  exclude: [],
  outDir: undefined,
  images: 'extract',
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Reads `configPath` (default: `docx2md.config.json` in `root`, which may be
 * absent) and lays `flags` over it.
 */
export async function loadOptions(
  root: string,
  flags: Partial<Options>,
  configPath?: string,
): Promise<Options> {
  const path = configPath ?? join(root, CONFIG_FILE);
  const file = Bun.file(path);
  let fromFile: Partial<Options> = {};
  if (await file.exists()) {
    let json: unknown;
    try {
      json = await file.json();
    } catch (error) {
      throw new ConfigError(`${path}: not valid JSON (${(error as Error).message})`);
    }
    fromFile = parseOptions(json, path);
  } else if (configPath !== undefined) {
    throw new ConfigError(`${path}: no such file`);
  }
  const defined = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined));
  return parseOptions({ ...DEFAULTS, ...fromFile, ...defined }, 'options') as Options;
}

/** Checks each known key and rejects unknown ones, so a typo fails loudly instead of being ignored. */
export function parseOptions(input: unknown, origin: string): Partial<Options> {
  const fail = (message: string): never => {
    throw new ConfigError(`${origin}: ${message}`);
  };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('must be a JSON object');
  }
  const out: { -readonly [K in keyof Options]?: Options[K] } = {};
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'include':
      case 'exclude':
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v !== '')) {
          fail(`"${key}" must be an array of non-empty glob strings`);
        }
        out[key] = value as string[];
        break;
      case 'outDir':
        if (value === undefined) break;
        if (typeof value !== 'string' || value === '') fail('"outDir" must be a non-empty string');
        out.outDir = relativeDirectory(value as string, fail);
        break;
      case 'images':
        if (!IMAGE_MODES.includes(value as ImageMode)) {
          fail(`"images" must be one of ${IMAGE_MODES.map((m) => `"${m}"`).join(', ')}`);
        }
        out.images = value as ImageMode;
        break;
      default:
        fail(`unknown option "${key}"`);
    }
  }
  return out;
}

/** Outputs stay inside the project: `outDir` is relative and never climbs out. */
function relativeDirectory(value: string, fail: (message: string) => never): string | undefined {
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (isAbsolute(value) || path.split('/').includes('..')) {
    fail('"outDir" must be a path inside the project (relative, no "..")');
  }
  return path === '' || path === '.' ? undefined : path;
}
