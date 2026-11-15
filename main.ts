// The graveyard radar's entrypoint (Node 22, standard library only).
//
// It reads the sealed snapshot (the default /input/snapshot.json, or --input
// <file|directory>), scores the pre-token protocols with the grave-1 model in
// lib/model.ts — a fitted size curve, an empirical launch table, and a
// graveyard of the protocols that will almost certainly never launch — and
// writes the entry's outputs:
//
//   board.json    the ranked board, one row per protocol, ranked by implied value
//   data.js       the same board, compact, for the dashboard to read
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's dossier, built by vendor/makefun-board.ts
//
// The board is ranked by implied value (if launched), non-increasing by
// rank, so the gate's sorted_by_value row holds. The graveyard — the
// dashboard's headline — is a view over the same data, ranked by P(never).
//
// The program is pure: the same snapshot always writes the same bytes, so
// the grader's two runs agree. Nothing here touches the network, and nothing
// writes outside the output directory.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's caps: the text cap shapes the bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print usage and exit 0. */
function printUsage(): void {
  process.stdout.write(
    `graveyard radar — build the best token launch radar (make.fun token-radar-01)\n` +
      `\n` +
      `usage: node main.ts [--input <snapshot.json|directory>] [--output <dir>] [--help]\n` +
      `\n` +
      `  --input <file|dir>   the sealed snapshot (default /input, else --input snapshot.json)\n` +
      `  --output <dir>       where the outputs go (default $MAKEFUN_OUTPUT_DIR, else /output)\n` +
      `  --help, -h           print this usage and exit\n` +
      `\n` +
      `Writes board.json, data.js, dashboard/, screenshots/ and dossier.json to the output\n` +
      `directory. The program is deterministic: the same snapshot always writes the same bytes.\n`,
  );
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

/** Read `--name <value>` (or `--name=<value>`) from the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1] as string;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`graveyard radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
if (snapshot.protocols.length === 0) {
  process.stderr.write('graveyard radar: the snapshot holds no protocols: nothing to rank\n');
  process.exit(2);
}
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`graveyard radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`graveyard radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the graveyard, a detail view and the board\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`graveyard radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const top = board.slice(0, 3).map((r) => `${r.name} $${Math.round(r.implied_value_usd / 1e6)}M`);
process.stdout.write(
  `graveyard radar: size curve log10(mcap) = ${radar.model.curve.intercept} + ${radar.model.curve.slope} x log10(TVL), R2 ${radar.model.curve.r2}, ${radar.model.curve.comps} comps\n` +
    `graveyard radar: LOO median miss x${radar.model.curve.looMiss}; time-split x${radar.model.curve.timeSplitMiss}; launch calibration MAE ${radar.model.launchTable.calibrationMae}\n` +
    `graveyard radar: graveyard ${radar.graveyard.length} protocols (P(never) >= 0.60); skipping them saves $${radar.graveyardSavings.gasUsd} gas and ${radar.graveyardSavings.hours} hours\n` +
    `graveyard radar: verdicts at $1,000: ${['ROBUST', 'FARM', 'THIN', 'SKIP'].map((v) => `${v} ${board.filter((r) => r.farm.verdict === v).length}`).join(' / ')}\n` +
    `graveyard radar: top by implied value: ${top.join(', ')}\n` +
    `graveyard radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
