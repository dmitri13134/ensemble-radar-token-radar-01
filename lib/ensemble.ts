// Ensemble Radar — a five-signal ensemble model for token-radar-01.
//
// One signal can lie. A protocol can be huge and shrinking, young and
// surging, or broad and flat. This model scores every pre-token protocol
// on five independent signals drawn only from the sealed snapshot, then
// blends them into one ensemble score. The board ranks by an implied
// value: the protocol's TVL priced at the multiple its own category's
// tokened peers actually trade at, tilted by the ensemble score. Two
// protocols with the same TVL can therefore rank far apart, and a
// protocol whose five signals disagree is flagged instead of hidden.
//
// Signals (each 0-100, higher is stronger):
//   scale     — log10 of TVL between $5M and $100B
//   momentum  — 7-day TVL change, clamped to [-30%, +60%], unreported = 50
//   tenure    — days listed / 1095, capped; unlisted = 50
//   breadth   — chain count, 1 chain = 35, doubling toward 100
//   peer      — category peer multiple vs the global median multiple
//
// Ensemble weights: scale .30, momentum .20, tenure .15, breadth .10,
// peer .25. Consensus is the spread (max - min) across the five signals:
// under 25 the signals agree, 25-50 they are mixed, over 50 they split.
//
// No protocol name is ever special-cased. Every number below comes from
// the snapshot: peer multiples are medians of the tokened protocols in
// the same category (global median when a category has fewer than three
// tokened peers), and every weight is a constant stated here and in the
// dashboard. The snapshot never says a token will launch; this model
// prices what a token would be worth if the record stayed as it is.

export interface SnapProtocol {
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

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export const ENSEMBLE_WEIGHTS = {
  scale: 0.3,
  momentum: 0.2,
  tenure: 0.15,
  breadth: 0.1,
  peer: 0.25,
} as const;

export const MODEL_VERSION = 'ensemble-1';
export const EARLY_CAP = 260;
export const LIVE_CAP = 24;

export interface SignalScores {
  scale: number;
  momentum: number;
  tenure: number;
  breadth: number;
  peer: number;
  ensemble: number;
  spread: number;
  consensus: 'agree' | 'mixed' | 'split';
}

export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  signals: SignalScores;
  farm_steps: string[];
}

export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number;
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: typeof ENSEMBLE_WEIGHTS;
  global_peer_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardEntry[];
  live: LiveEntry[];
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Log-scale size score: $5M scores 0, $100B scores 100. */
export function scaleScore(tvl: number): number {
  const lo = Math.log10(5_000_000);
  const hi = Math.log10(100_000_000_000);
  return round2(clamp(((Math.log10(Math.max(tvl, 1)) - lo) / (hi - lo)) * 100, 0, 100));
}

/** Weekly flow score: -30% scores 0, +60% scores 100, unreported is neutral. */
export function momentumScore(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 50;
  return round2(clamp(((clamp(change7d, -30, 60) + 30) / 90) * 100, 0, 100));
}

/** Tenure score: 3 years listed scores 100, unlisted is neutral. */
export function tenureScore(age: number | null): number {
  if (age === null) return 50;
  return round2(clamp((age / 1095) * 100, 0, 100));
}

/** Breadth score: one chain scores 35, each doubling adds toward 100. */
export function breadthScore(chainCount: number): number {
  const n = Math.max(1, chainCount);
  return round2(clamp(35 + (Math.log2(n) / 4) * 65, 0, 100));
}

/** Peer score: a multiple at the global median scores 50, each doubling adds 25. */
export function peerScore(multiple: number, globalMedian: number): number {
  const ratio = multiple / Math.max(globalMedian, 1e-9);
  return round2(clamp(50 + 25 * Math.log2(Math.max(ratio, 1 / 64)), 0, 100));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Median mcap/TVL of a category's tokened peers, else the global median. */
export function peerMultiples(protocols: SnapProtocol[]): {
  byCategory: Map<string, number>;
  global: number;
} {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const mult = p.mcap_usd / p.tvl_usd;
    all.push(mult);
    const key = p.category ?? '(no category)';
    const list = byCategory.get(key) ?? [];
    list.push(mult);
    byCategory.set(key, list);
  }
  const global = median(all);
  const out = new Map<string, number>();
  for (const [key, list] of byCategory) {
    out.set(key, list.length >= 3 ? median(list) : global);
  }
  return { byCategory: out, global };
}

export function scoreSignals(
  p: SnapProtocol,
  asOf: string,
  multiple: number,
  globalMedian: number,
): SignalScores {
  const age = ageDays(asOf, p.listed_at);
  const scale = scaleScore(p.tvl_usd);
  const momentum = momentumScore(p.change_7d);
  const tenure = tenureScore(age);
  const breadth = breadthScore(p.chains.length);
  const peer = peerScore(multiple, globalMedian);
  const ensemble = round2(
    scale * ENSEMBLE_WEIGHTS.scale +
      momentum * ENSEMBLE_WEIGHTS.momentum +
      tenure * ENSEMBLE_WEIGHTS.tenure +
      breadth * ENSEMBLE_WEIGHTS.breadth +
      peer * ENSEMBLE_WEIGHTS.peer,
  );
  const spread = round2(Math.max(scale, momentum, tenure, breadth, peer) - Math.min(scale, momentum, tenure, breadth, peer));
  const consensus: SignalScores['consensus'] = spread < 25 ? 'agree' : spread <= 50 ? 'mixed' : 'split';
  return { scale, momentum, tenure, breadth, peer, ensemble, spread, consensus };
}

export function recordsNoToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_OPEN = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** A pre-token protocol the early radar may add below the watchlist floor. */
export function isEarlyCandidate(p: SnapProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_OPEN.test(p.name)) return false;
  return true;
}

/** Implied value: TVL at the category peer multiple, tilted by the ensemble. */
export function impliedValue(tvl: number, multiple: number, ensemble: number): number {
  const tilt = 0.55 + 0.45 * (ensemble / 100);
  return Math.max(1, Math.round(tvl * multiple * tilt));
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function chainName(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

function stakeFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 300;
  if (tvl >= 1_000_000_000) return 200;
  if (tvl >= 100_000_000) return 120;
  return 60;
}

function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 12;
  if (age < 365) return 8;
  return 6;
}

function verbFor(p: SnapProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'provide liquidity';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator')) return 'deposit into a vault';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('stak') || c.includes('restak')) return 'stake';
  if (c.includes('perpetual') || c.includes('derivative')) return 'trade with margin';
  if (c.includes('stable')) return 'mint the stable asset';
  if (c.includes('rwa')) return 'mint the yield asset';
  if (c.includes('prediction')) return 'take a market position';
  return 'deposit';
}

function actionLine(p: SnapProtocol, stake: number, chain: string): string {
  const verb = verbFor(p);
  switch (verb) {
    case 'lend':
      return `Lend $${stake} of USDC on ${p.name} (${chain}) and leave the loan open so the position accrues.`;
    case 'provide liquidity':
      return `Add $${stake} of liquidity to ${p.name}'s deepest pool on ${chain} and keep the LP position open.`;
    case 'deposit into a vault':
      return `Deposit $${stake} of USDC into a ${p.name} vault on ${chain} and hold the vault shares.`;
    case 'bridge':
      return `Bridge $${stake} of USDC into ${chain} through ${p.name}, then use the bridged funds inside its app.`;
    case 'stake':
      return `Stake $${stake} of the chain asset through ${p.name} on ${chain} and keep the staking receipt.`;
    case 'trade with margin':
      return `Deposit $${stake} of USDC as margin on ${p.name} (${chain}) and open one small hedged trade.`;
    case 'mint the stable asset':
      return `Mint $${stake} of the stable asset through ${p.name} on ${chain} and hold it in the same wallet.`;
    case 'mint the yield asset':
      return `Mint $${stake} of the yield asset from ${p.name} on ${chain} and hold it for the full farming window.`;
    case 'take a market position':
      return `Fund $${stake} on ${p.name} (${chain}) and take one position in an active market.`;
    default:
      return `Deposit $${stake} of USDC into ${p.name} on ${chain} and keep the position open for the full window.`;
  }
}

/**
 * Five concrete farm steps, each with its cost and its time, derived from
 * the protocol's own record (category, chain, TVL, age) — never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapProtocol, age: number | null): string[] {
  const chain = chainName(p);
  const stake = stakeFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const steps = [
    `Open a fresh wallet that holds only the $${stake} you plan to farm with, and write its seed phrase on paper before you fund it. Cost: under $3 of gas for the first transfer. Time: 10 minutes.`,
    `${actionLine(p, stake, chain)} Cost: $${stake} of capital plus about $${stake >= 200 ? 10 : 5} of gas and fees. Time: 20 minutes to set up.`,
    `Return once a week for ${weeks} weeks and make one real on-chain action: a deposit, a swap, a borrow, or a vote, so the wallet shows a pattern instead of a single deposit. Cost: about $2 of gas per week. Time: 10 minutes a week.`,
    `Keep the position open for the full ${weeks}-week window, and check the protocol's own rewards page weekly for points, quests, or tasks it publishes itself. Cost: the $${stake} stays locked in the position. Time: ${weeks} weeks.`,
    `When the window ends, claim only through the link the protocol itself publishes, then unwind half the position and leave the rest running in case a second season opens. Cost: about $4 of gas to claim and exit. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 597)}...` : s));
}

export function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new Error('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new Error('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new Error('snapshot.json has no watchlist of slugs');
  }
  const protocols = (o.protocols as Record<string, unknown>[]).map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new Error(`snapshot protocol ${i} is not an object`);
    }
    if (typeof v.slug !== 'string' || typeof v.name !== 'string' || typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd)) {
      throw new Error(`snapshot protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: v.slug,
      name: v.name,
      category: typeof v.category === 'string' ? v.category : null,
      chains: Array.isArray(v.chains) ? v.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: typeof v.change_7d === 'number' && Number.isFinite(v.change_7d) ? v.change_7d : null,
      mcap_usd: typeof v.mcap_usd === 'number' && Number.isFinite(v.mcap_usd) ? v.mcap_usd : null,
      listed_at: typeof v.listed_at === 'string' ? v.listed_at : null,
      gecko_id: typeof v.gecko_id === 'string' ? v.gecko_id : null,
      symbol: typeof v.symbol === 'string' ? v.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** The full ranked board: every watchlist slug, plus the strongest early finds. */
export function buildBoard(snapshot: SnapshotDoc): { board: BoardEntry[]; payload: RadarPayload } {
  const { byCategory, global } = peerMultiples(snapshot.protocols);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_CAP);
  for (const p of early) chosen.set(p.slug, p);

  const scored: BoardEntry[] = [...chosen.values()].map((p) => {
    const multiple = byCategory.get(p.category ?? '(no category)') ?? global;
    const signals = scoreSignals(p, snapshot.as_of, multiple, global);
    const age = ageDays(snapshot.as_of, p.listed_at);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      implied_value_usd: impliedValue(p.tvl_usd, multiple, signals.ensemble),
      peer_multiple: round2(multiple),
      signals,
      farm_steps: farmSteps(p, age),
    };
  });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveEntry[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_CAP)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: round2(p.tvl_usd > 0 ? (p.mcap_usd ?? 0) / p.tvl_usd : 0),
    }));

  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    weights: ENSEMBLE_WEIGHTS,
    global_peer_multiple: round2(global),
    watchlist_size: snapshot.watchlist.length,
    board_size: scored.length,
    early_size: early.length,
    live_size: live.length,
    rows: scored,
    live,
  };
  return { board: scored, payload };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share one implied value: not a ranking';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script tag's worth of JavaScript, no fetch. */
export function dataScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}

export { money };
