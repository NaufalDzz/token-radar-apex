// Launch Radar Apex — token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), fits both halves of the model with the
// shared engine in dashboard/model.js (see lib/model.ts), refuses to write a board the gate would refuse, then
// writes /output/board.json, /output/data.js (the raw snapshot plus board.json's ranks for the page to re-verify),
// copies dashboard/ and screenshots/, and writes /output/dossier.json last with the vendored make.fun library.
// Deterministic: no clock, no randomness beyond a seeded bootstrap, so two runs write the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code = 1): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(code);
}

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount /input`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, checksum } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: 'launch-radar-apex-v4', as_of: snapshot.as_of, checksum_fnv1a: checksum, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(snapshot, board, checksum));

/** Replaces `to` with one directory's regular files (no dotfiles), so a rerun leaves no stale file; returns their names. */
function copyFiles(from: string, to: string): string[] {
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n}: a name is letters, digits and . _ -`);

// The dossier is written last: the scorer rebuilds it from this directory and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const l = radar.ledger;
process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols read; ranked ${board.length} (watchlist ${l.watch ?? 0}, early ${l.early ?? 0}, off-list ${l.off ?? 0}); ` +
    `set aside ${(l.trade ?? 0) + (l.recorded ?? 0)} token-recording and ${(l.cex ?? 0) + (l.bridge ?? 0) + (l.lst ?? 0) + (l.wrap ?? 0)} by rule\n` +
    `launch radar: value terms kept [${radar.V.terms.join(', ')}], walk-forward miss x${radar.V.best.wf.toFixed(2)}; odds terms kept [${radar.O.terms.join(', ')}], walk-forward Brier ${radar.O.best.wf.toFixed(3)}\n` +
    `launch radar: checksum ${checksum}; wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
