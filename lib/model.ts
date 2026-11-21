// Launch Radar Apex: the typed side of the model.
//
// The fitting engine itself lives in dashboard/model.js so that exactly one implementation exists: main.ts runs it
// here in Node to write board.json, and the dashboard runs the same file in the browser on the raw snapshot and
// checks every row it gets against board.json (rank, slug, implied value, FNV-1a checksum). This module parses the
// snapshot, runs the engine, re-checks the gate's rules before anything is written, and writes data.js.
//
//   implied value = TVL x fitted multiple (value if a token launches) x token odds (peers' record) x family factor
//
// Part A (fitValuationModel) regresses log10(market cap / family TVL) over the snapshot's traded tokens; Part B
// (fitTokenOddsModel) is a ridge logistic regression of "records a token" over every standalone protocol. Each
// candidate term is kept only when it lowers BOTH held-out errors (leave-one-out / ten-fold and walk-forward by
// listing date). No protocol name is special-cased anywhere.

import { createRequire } from 'node:module';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json. Extra keys beyond the gate's five are allowed and carry the model's working. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  tier: 'watch' | 'off' | 'early';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  value_if_launch_usd: number;
  token_odds: number;
  family_factor: number;
  rank_range: [number, number];
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  deposit_usd: number;
  fees_usd: number;
  net_usd: number;
  hours: number;
  farm_steps: string[];
}

/** What the engine returns that main.ts uses; the rest stays inside the engine and the page. */
export interface Radar {
  rows: unknown[];
  ledger: Record<string, number>;
  V: { terms: string[]; n: number; best: { loo: number; wf: number } };
  O: { terms: string[]; n: number; pos: number; best: { loo: number; wf: number } };
}

interface Engine {
  runRadar(s: Snapshot): Radar;
  boardRows(r: Radar): BoardRow[];
  checksum(rows: BoardRow[]): string;
}

const engine = createRequire(import.meta.url)('../dashboard/model.js') as Engine;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The snapshot out of a file's text, refused unless it has the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    const p = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    const tvl = num(p.tvl_usd);
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || tvl === null || tvl <= 0) throw new SnapshotError(`protocol ${i} lacks a slug, a name or a positive TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: tvl,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: str(o.source) ?? '', floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Runs the shared engine: the ranked board plus everything the page draws. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar; checksum: string } {
  const radar = engine.runRadar(snapshot);
  const board = engine.boardRows(radar);
  return { board, radar, checksum: engine.checksum(board) };
}

/** Why the gate would refuse this board, or null: coverage, ranks, order, a shared value, steps, slugs. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows (100 to 4,000)`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `slugs the snapshot does not list: ${invented.slice(0, 3).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  if (byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.name.trim() === '') return `${r.slug} has no name`;
    // The gate allows 3-12 steps of 20-600 characters; this entry holds itself to 5-6 steps of 50-250.
    if (r.farm_steps.length < 5 || r.farm_steps.length > 6) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 50 || s.trim().length > 250) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** data.js: the raw snapshot the page refits from, plus board.json's ranks and values it must reproduce. */
export function dataScript(snapshot: Snapshot, board: BoardRow[], checksum: string): string {
  const expect = board.map((r) => [r.rank, r.slug, r.implied_value_usd]);
  const total = board.reduce((a, r) => a + r.implied_value_usd, 0);
  return `window.RADAR_DATA=${JSON.stringify({ snapshot, board: expect, checksum, total })};\n`;
}
