#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  finalizePetVideo,
  resolveMediaToolchain,
} from '../lib/video/pet-video-finalizer.ts';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

type Cli = {
  raw: string;
  anchor: string;
  output: string;
  pocSalvage: boolean;
};

function usage() {
  return `Usage:
  npm run pet:finalize -- --raw <raw.mp4> --anchor <canonical.png> --out <final.mp4>

Options:
  --poc-salvage  Compile a known demo even when the raw source seam gate fails.
                 This is forbidden in the automatic four-GPU publisher.`;
}

function parseArgs(argv: string[]): Cli {
  const result: Cli = { raw: '', anchor: '', output: '', pocSalvage: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--raw') result.raw = argv[++index] ?? '';
    else if (arg === '--anchor') result.anchor = argv[++index] ?? '';
    else if (arg === '--out') result.output = argv[++index] ?? '';
    else if (arg === '--poc-salvage') result.pocSalvage = true;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  if (!result.raw || !result.anchor || !result.output) throw new Error(usage());
  return result;
}

const cli = parseArgs(process.argv.slice(2));
const toolchain = await resolveMediaToolchain(projectRoot);
const result = await finalizePetVideo({
  projectRoot,
  rawFile: resolve(projectRoot, cli.raw),
  anchorFile: resolve(projectRoot, cli.anchor),
  outputFile: resolve(projectRoot, cli.output),
  toolchain,
  enforceSourceGate: !cli.pocSalvage,
});

console.log(JSON.stringify({
  toolchain: { source: toolchain.source, version: toolchain.ffmpegVersion },
  mode: cli.pocSalvage ? 'poc_salvage' : 'publishable',
  ...result,
}, null, 2));
