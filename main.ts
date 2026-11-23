// Ensemble Radar — token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// five-signal ensemble in lib/ensemble.ts, and writes the ranked board,
// the dashboard data, the dashboard, the screenshots and the dossier
// the judge reads. Run it as:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is deterministic: the same snapshot bytes in give the same
// bytes out. It runs twice in the grader and both runs must agree, so
// nothing here reads the clock, the network, or a random source.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/ensemble.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`ensemble radar: no snapshot at ${inputPath} — pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, payload } = buildBoard(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  process.stderr.write(`ensemble radar: the board fails the gate: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(payload));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length === 0 || !dashFiles.includes('index.html')) {
  process.stderr.write('ensemble radar: dashboard/ has no index.html to copy\n');
  process.exit(1);
}
if (shotFiles.length < 3) {
  process.stderr.write(`ensemble radar: screenshots/ holds ${shotFiles.length} images: hand in 3 (board, detail, filtered)\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  if (!FILE_NAME.test(name)) {
    process.stderr.write(`ensemble radar: screenshots/${name} is not a legal file name\n`);
    process.exit(1);
  }
}

// Dossier last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAP, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `ensemble radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows (${payload.early_size} early finds, ${payload.live_size} live peers set aside)\n` +
    `ensemble radar: wrote board.json, data.js, dashboard (${dashFiles.length} files), screenshots (${shotFiles.length} images), dossier.json\n`,
);
