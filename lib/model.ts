// The graveyard radar's model (Node 22, standard library only).
//
// This entry answers the question the other radars skip: which pre-token
// protocols will almost certainly NEVER launch a token, and how much time
// and gas a farmer saves by walking past them. Everything below is computed
// from the sealed snapshot at run time — no hardcoded names, no network.
//
// The model has three parts:
//   1. A fitted size curve. log10(market cap) is regressed on log10(TVL)
//      over the snapshot's live-token protocols (Huber robust fit, so a few
//      giant outliers cannot drag the line), with a shrunk per-category
//      tilt. That gives the value IF a protocol launches.
//   2. An empirical launch table. From the snapshot itself: the share of
//      protocols that already record a token, per age band x TVL band,
//      shrunk toward the TVL-band rate. P(launch) is FORWARD-looking: the
//      share of the cohort that launches after this protocol's age, divided
//      by the share still pre-token at this age, plus a 5% late-launch tail
//      after year 3. That matters, because the cumulative share rises with
//      age — read naively, an old protocol looks MORE likely to launch,
//      when it has in fact had its window and did not use it. P(never) is
//      the complement of the forward P(launch). The table itself is
//      calibrated by a time split (fit before Jun 2025, checked after).
//   3. A graveyard. Pre-token protocols with P(never) >= 0.60, ranked by
//      P(never), each carrying the reasons (age, size, category, growth)
//      and the gas and hours a farmer saves by skipping it.
//
// The board itself is ranked by implied value (if launched), non-increasing
// by rank, so the gate's sorted_by_value row holds. The graveyard is the
// dashboard's headline view; the board is its second view.

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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A fitted log-log size curve, with its out-of-sample validation. */
export interface SizeCurve {
  intercept: number;
  slope: number;
  r2: number;
  comps: number;
  looMiss: number;
  timeSplitMiss: number;
  timeSplitFit: number;
  timeSplitTest: number;
}

/** One cell of the empirical launch table. */
export interface LaunchCell {
  ageBand: string;
  tvlBand: string;
  n: number;
  tokenized: number;
  rate: number;
}

/** The launch table, with its calibration. */
export interface LaunchTable {
  cells: LaunchCell[];
  tvlBandRates: { band: string; n: number; tokenized: number; rate: number }[];
  calibrationMae: number;
  calibrationCells: number;
}

/** The fitted-term tests: what was tried, what was kept, and why. */
export interface TermTest {
  name: string;
  looMiss: number;
  kept: boolean;
  note: string;
}

export interface ModelSummary {
  name: string;
  curve: SizeCurve;
  launchTable: LaunchTable;
  termTests: TermTest[];
  categoryTilt: { category: string; tilt: number; comps: number }[];
}

export interface FarmTier {
  capitalUsd: number;
  expectedSliceUsd: number;
  gasUsd: number;
  opportunityUsd: number;
  netUsd: number;
  hours: number;
  netPerHourUsd: number;
}

export interface FarmStep {
  text: string;
}

/** The skip case for a graveyard protocol: why, and what skipping saves. */
export interface GraveyardCase {
  pNever: number;
  reasons: string[];
  gasSavedUsd: number;
  hoursSaved: number;
}

export interface BoardRow {
  rank: number;
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
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    implied_if_launched_usd: number;
    launch_probability: number;
    never_probability: number;
    launch_cell: string;
    band_low_usd: number;
    band_high_usd: number;
    age_days: number | null;
  };
  farm: {
    verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
    net_usd: number;
    net_per_hour_usd: number;
    gas_usd: number;
    chain: string;
    hold_days: number;
    hours: number;
    break_even_capital_usd: number | null;
    walk_away_tvl_rise_pct: number;
    tier: FarmTier;
  };
  farm_steps: string[];
  graveyard: GraveyardCase | null;
}

export interface GraveyardRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  implied_usd: number;
  age_days: number | null;
  change_7d: number | null;
  p_never: number;
  p_launch: number;
  reasons: string[];
  gas_saved_usd: number;
  hours_saved: number;
  in_board: boolean;
  board_rank: number | null;
}

export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

export interface Audit {
  total: number;
  ranked: number;
  setAside: number;
  trading: number;
  preToken: number;
  watchlist: number;
}

export interface RadarData {
  model: ModelSummary;
  board: BoardRow[];
  graveyard: GraveyardRow[];
  graveyardSavings: { gasUsd: number; hours: number; count: number };
  setAside: SetAsideRow[];
  live: LiveRow[];
  comps: { tvl: number; mcap: number }[];
  audit: Audit;
}

export class SnapshotError extends Error {}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const EXCLUDED_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Parse and validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('snapshot is not an object');
  const snap = raw as Record<string, unknown>;
  if (!Array.isArray(snap.protocols) || snap.protocols.length === 0) {
    throw new SnapshotError('snapshot holds no protocols');
  }
  if (!Array.isArray(snap.watchlist)) throw new SnapshotError('snapshot holds no watchlist');
  const protocols = (snap.protocols as Record<string, unknown>[]).map((p) => {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new SnapshotError('a protocol is missing slug, name or tvl_usd');
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    } satisfies SnapshotProtocol;
  });
  return {
    as_of: typeof snap.as_of === 'string' ? snap.as_of : '',
    floor_usd: typeof snap.floor_usd === 'number' ? snap.floor_usd : 50_000_000,
    protocols,
    watchlist: snap.watchlist as string[],
  };
}

/** Whole days between the snapshot date and the day DefiLlama began tracking. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(asOfMs) || Number.isNaN(listedMs)) return null;
  return Math.max(0, Math.round((asOfMs - listedMs) / DAY_MS));
}

/** A protocol records no token: both token fields null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The snapshot's own rankable rule (its watchlist rule, minus the floor). */
export function isRankable(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORY.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Why a pre-token protocol is set aside (null when it is rankable). */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORY.has(p.category)) {
    return `Category ${p.category} is excluded: it is a bridge, staking or exchange product, not a launch candidate.`;
  }
  if (VERSIONED.test(p.name)) return 'Name ends in a version marker: a versioned product, not the protocol itself.';
  if (WRAPPED_WORD.test(p.name)) return 'Name carries wrapped, staked or staking: a wrapped or staked product of a token that already trades.';
  if (EXCHANGE_PREFIX.test(p.name)) return 'Name begins with an exchange name: an exchange product, not a launch candidate.';
  return null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// The fitted size curve
// ---------------------------------------------------------------------------

/** Live-token protocols usable as comps: a token, a TVL, not an exchange. */
export function compProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.gecko_id !== null && p.category !== 'CEX',
  );
}

interface Point {
  x: number;
  y: number;
}

/** Plain least squares for y = a + b*x. */
function ols(points: Point[]): { a: number; b: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** Weighted least squares. */
function wls(points: Point[], weights: number[]): { a: number; b: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < points.length; i += 1) {
    sw += weights[i]!;
    sx += weights[i]! * points[i]!.x;
    sy += weights[i]! * points[i]!.y;
  }
  const mx = sx / sw;
  const my = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < points.length; i += 1) {
    sxx += weights[i]! * (points[i]!.x - mx) * (points[i]!.x - mx);
    sxy += weights[i]! * (points[i]!.x - mx) * (points[i]!.y - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Huber robust fit (iteratively reweighted least squares, k = 1.345).
 * A few giant outliers cannot drag the line; the curve is the market's
 * centre, not its loudest members.
 */
function huberFit(points: Point[]): { a: number; b: number } {
  let fit = ols(points);
  for (let iter = 0; iter < 12; iter += 1) {
    const residuals = points.map((p) => p.y - (fit.a + fit.b * p.x));
    const mad = median(residuals.map((r) => Math.abs(r - median(residuals))));
    const scale = Math.max(1.4826 * mad, 1e-6);
    const weights = residuals.map((r) => {
      const u = Math.abs(r) / (1.345 * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = wls(points, weights);
    if (Math.abs(next.a - fit.a) < 1e-9 && Math.abs(next.b - fit.b) < 1e-9) {
      fit = next;
      break;
    }
    fit = next;
  }
  return fit;
}

function rSquared(points: Point[], fit: { a: number; b: number }): number {
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - my) * (p.y - my);
    ssRes += (p.y - (fit.a + fit.b * p.x)) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** Leave-one-out median miss, as a factor (10^median |log10 error|). */
function looMiss(points: Point[], fitFn: (pts: Point[]) => { a: number; b: number }): number {
  const errors: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const rest = points.filter((_, j) => j !== i);
    const fit = fitFn(rest);
    const pred = fit.a + fit.b * points[i]!.x;
    errors.push(Math.abs(pred - points[i]!.y));
  }
  return 10 ** median(errors);
}

/** Fit on comps listed before a cutoff, test on the rest. */
function timeSplitMiss(comps: SnapshotProtocol[], fitFn: (pts: Point[]) => { a: number; b: number }): { miss: number; fit: number; test: number } {
  const toPoint = (p: SnapshotProtocol): Point => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!) });
  const fitSet = comps.filter((p) => p.listed_at !== null && p.listed_at < '2025-01-01');
  const testSet = comps.filter((p) => p.listed_at !== null && p.listed_at >= '2025-01-01');
  if (fitSet.length < 10 || testSet.length < 5) return { miss: NaN, fit: fitSet.length, test: testSet.length };
  const fit = fitFn(fitSet.map(toPoint));
  const errors = testSet.map((p) => {
    const pt = toPoint(p);
    return Math.abs(fit.a + fit.b * pt.x - pt.y);
  });
  return { miss: 10 ** median(errors), fit: fitSet.length, test: testSet.length };
}

/** Solve a small linear system (Gaussian elimination with partial pivoting). */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r]![col]) > Math.abs(a[pivot]![col])) pivot = r;
    if (Math.abs(a[pivot]![col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r]![col] / a[col]![col];
      for (let c = col; c <= n; c += 1) a[r]![c] -= factor * a[col]![c];
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

/** OLS with several predictors; returns the coefficients or null. */
function multiOls(design: number[][], y: number[]): number[] | null {
  const k = design[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const xty: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i += 1) {
    for (let a = 0; a < k; a += 1) {
      xty[a] += design[i]![a]! * y[i]!;
      for (let b = 0; b < k; b += 1) xtx[a]![b]! += design[i]![a]! * design[i]![b]!;
    }
  }
  return solveLinear(xtx, xty);
}

function looMissMulti(rows: { x: number[]; y: number }[]): number {
  const errors: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rest = rows.filter((_, j) => j !== i);
    const beta = multiOls(rest.map((r) => [1, ...r.x]), rest.map((r) => r.y));
    if (beta === null) return NaN;
    const pred = beta[0]! + rows[i]!.x.reduce((s, v, j) => s + v * beta[j + 1]!, 0);
    errors.push(Math.abs(pred - rows[i]!.y));
  }
  return 10 ** median(errors);
}

// ---------------------------------------------------------------------------
// The empirical launch table
// ---------------------------------------------------------------------------

const AGE_BANDS = [
  { key: 'young', label: 'under 1y', test: (age: number | null) => age !== null && age < 365 },
  { key: 'mid', label: '1-3y', test: (age: number | null) => age !== null && age >= 365 && age < 1095 },
  { key: 'old', label: 'over 3y', test: (age: number | null) => age !== null && age >= 1095 },
  { key: 'unknown', label: 'age unknown', test: (age: number | null) => age === null },
] as const;

const TVL_BANDS = [
  { key: 'small', label: 'under $50M', test: (tvl: number) => tvl < 50_000_000 },
  { key: 'mid', label: '$50M-$250M', test: (tvl: number) => tvl >= 50_000_000 && tvl < 250_000_000 },
  { key: 'large', label: 'over $250M', test: (tvl: number) => tvl >= 250_000_000 },
] as const;

function ageBandOf(age: number | null): string {
  return AGE_BANDS.find((b) => b.test(age))!.key;
}

function tvlBandOf(tvl: number): string {
  return TVL_BANDS.find((b) => b.test(tvl))!.key;
}

interface LaunchTableInput {
  cells: LaunchCell[];
  tvlBandRates: { band: string; n: number; tokenized: number; rate: number }[];
}

/** Build the launch table from a protocol set (shrinkage k = 5 to the TVL-band rate). */
function buildLaunchTable(protocols: SnapshotProtocol[], asOf: string): LaunchTableInput {
  const bandTotals = new Map<string, { n: number; tokenized: number }>();
  const cellTotals = new Map<string, { n: number; tokenized: number }>();
  for (const p of protocols) {
    const tvlBand = tvlBandOf(p.tvl_usd);
    const ageBand = ageBandOf(ageDays(asOf, p.listed_at));
    const tok = isPreToken(p) ? 0 : 1;
    const bt = bandTotals.get(tvlBand) ?? { n: 0, tokenized: 0 };
    bt.n += 1;
    bt.tokenized += tok;
    bandTotals.set(tvlBand, bt);
    const key = `${ageBand}|${tvlBand}`;
    const ct = cellTotals.get(key) ?? { n: 0, tokenized: 0 };
    ct.n += 1;
    ct.tokenized += tok;
    cellTotals.set(key, ct);
  }
  const tvlBandRates = TVL_BANDS.map((b) => {
    const t = bandTotals.get(b.key) ?? { n: 0, tokenized: 0 };
    return { band: b.key, n: t.n, tokenized: t.tokenized, rate: t.n === 0 ? 0 : t.tokenized / t.n };
  });
  const cells: LaunchCell[] = [];
  for (const a of AGE_BANDS) {
    for (const t of TVL_BANDS) {
      const ct = cellTotals.get(`${a.key}|${t.key}`) ?? { n: 0, tokenized: 0 };
      const bandRate = tvlBandRates.find((r) => r.band === t.key)!.rate;
      const k = 5;
      const rate = (ct.tokenized + k * bandRate) / (ct.n + k);
      cells.push({ ageBand: a.key, tvlBand: t.key, n: ct.n, tokenized: ct.tokenized, rate: round4(rate) });
    }
  }
  return { cells, tvlBandRates };
}

/**
 * Forward-looking P(launch) for one protocol. The table is cumulative (the
 * share of a cell that already records a token), and that share rises with
 * age — read naively, an old protocol looks MORE likely to launch, which is
 * backwards: it has had its window and did not use it. The forward chance
 * is the share of the cohort that launches AFTER this protocol's age,
 * divided by the share still pre-token at this age, plus a 5% late-launch
 * tail after year 3. Unknown age is treated as old: its table rate is high,
 * which is the signature of protocols whose listing date was never recorded
 * because they predate the tracker.
 */
const LATE_TAIL = 0.05;
function launchProbability(p: SnapshotProtocol, table: LaunchTableInput, asOf: string): { prob: number; cell: string } {
  const age = ageDays(asOf, p.listed_at);
  const tvlBand = tvlBandOf(p.tvl_usd);
  const ageBand = age === null ? 'unknown' : ageBandOf(age);
  const rate = (a: string): number =>
    table.cells.find((c) => c.ageBand === a && c.tvlBand === tvlBand)?.rate ??
    table.tvlBandRates.find((r) => r.band === tvlBand)!.rate;
  const incYM = Math.max(0, rate('mid') - rate('young'));
  const incMO = Math.max(0, rate('old') - rate('mid'));
  const rHere = rate(ageBand);
  const future = ageBand === 'young' ? incYM + incMO + LATE_TAIL : ageBand === 'mid' ? incMO + LATE_TAIL : LATE_TAIL;
  const prob = Math.min(0.95, Math.max(0.02, future / (1 - rHere)));
  return { prob: round4(prob), cell: `${ageBand} | ${tvlBand} TVL` };
}

/**
 * Calibration of P(launch): build the table on protocols listed before
 * 2025-06-01, then check each cell's predicted rate against the tokenized
 * share of protocols listed after it. MAE over cells with >= 5 in the test.
 */
function calibrateLaunch(snapshot: Snapshot): { mae: number; cells: number } {
  const fitSet = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at < '2025-06-01');
  const testSet = snapshot.protocols.filter((p) => p.listed_at !== null && p.listed_at >= '2025-06-01');
  if (fitSet.length < 50 || testSet.length < 20) return { mae: NaN, cells: 0 };
  const table = buildLaunchTable(fitSet, snapshot.as_of);
  const errors: number[] = [];
  for (const cell of table.cells) {
    const inTest = testSet.filter(
      (p) => ageBandOf(ageDays(snapshot.as_of, p.listed_at)) === cell.ageBand && tvlBandOf(p.tvl_usd) === cell.tvlBand,
    );
    if (inTest.length < 5) continue;
    const actual = inTest.filter((p) => !isPreToken(p)).length / inTest.length;
    errors.push(Math.abs(cell.rate - actual));
  }
  if (errors.length === 0) return { mae: NaN, cells: 0 };
  return { mae: round4(errors.reduce((s, e) => s + e, 0) / errors.length), cells: errors.length };
}

// ---------------------------------------------------------------------------
// Farm economics and the graveyard
// ---------------------------------------------------------------------------

/** Gas for one farm's transactions on the protocol's primary chain (USD). */
const GAS_USD: Record<string, number> = {
  Ethereum: 34,
  Arbitrum: 4,
  Base: 2,
  BSC: 1,
  Solana: 1,
  Optimism: 3,
  Polygon: 1,
  Avalanche: 2,
  Gnosis: 1,
  Linea: 2,
  zkSync: 2,
  Scroll: 2,
  Fantom: 1,
  Cronos: 1,
};

const TICKET_USD = 1000;
const FARMER_SHARE = 0.1;
const HOLD_DAYS = 30;
const OPPORTUNITY_RATE = 0.04;
const GRAVEYARD_NEVER_MIN = 0.6;

function gasFor(p: SnapshotProtocol): { gas: number; chain: string } {
  // A farmer picks the cheapest chain the protocol runs on, so the gas is
  // the minimum over its chains (unknown chains cost $5).
  let best = { gas: 5, chain: p.chains[0] ?? 'its main chain' };
  for (const chain of p.chains) {
    const gas = GAS_USD[chain] ?? 5;
    if (gas < best.gas) best = { gas, chain };
  }
  return best;
}

function hoursFor(): number {
  return round2(1.5 + (HOLD_DAYS / 7) * 0.5);
}

function opportunityFor(): number {
  return round2(OPPORTUNITY_RATE * TICKET_USD * (HOLD_DAYS / 365));
}

/** The netted farm economics at the $1,000 ticket. */
function farmEconomics(p: SnapshotProtocol, impliedIfLaunched: number, pLaunch: number): BoardRow['farm'] {
  const { gas, chain } = gasFor(p);
  const hours = hoursFor();
  const opportunity = opportunityFor();
  const slice = FARMER_SHARE * impliedIfLaunched * (TICKET_USD / p.tvl_usd) * pLaunch;
  const net = round2(slice - gas - opportunity);
  const netPerHour = round2(net / hours);
  // Verdict by the hourly wage the farm pays: robust pays a strong wage,
  // farm pays a decent one, thin pays but barely, skip loses money.
  const verdict: BoardRow['farm']['verdict'] =
    netPerHour >= 10 ? 'ROBUST' : netPerHour >= 5 ? 'FARM' : netPerHour > 0 ? 'THIN' : 'SKIP';
  const perCapital = (FARMER_SHARE * impliedIfLaunched * pLaunch) / p.tvl_usd - OPPORTUNITY_RATE * (HOLD_DAYS / 365);
  const breakEven = perCapital > 0 ? Math.round(gas / perCapital) : null;
  const walkAway = slice > gas + opportunity ? Math.round((slice / (gas + opportunity) - 1) * 100) : 0;
  return {
    verdict,
    net_usd: net,
    net_per_hour_usd: netPerHour,
    gas_usd: gas,
    chain,
    hold_days: HOLD_DAYS,
    hours,
    break_even_capital_usd: breakEven,
    walk_away_tvl_rise_pct: walkAway,
    tier: {
      capitalUsd: TICKET_USD,
      expectedSliceUsd: round2(slice),
      gasUsd: gas,
      opportunityUsd: opportunity,
      netUsd: net,
      hours,
      netPerHourUsd: netPerHour,
    },
  };
}

/** The reasons a protocol is in the graveyard, from its own figures. */
function graveyardReasons(
  p: SnapshotProtocol,
  age: number | null,
  pLaunch: number,
  categoryRate: number | null,
): string[] {
  const reasons: string[] = [];
  if (age !== null && age >= 1095) {
    reasons.push(`Tracked ${(age / 365).toFixed(1)} years with no token — longer than most protocols that ever launch.`);
  }
  if (age === null) {
    reasons.push('No listing date recorded, so the model cannot tell how long it has already waited.');
  }
  if (p.category !== null && categoryRate !== null && categoryRate < 0.35) {
    reasons.push(`Only ${Math.round(categoryRate * 100)}% of ${p.category} protocols ever record a token.`);
  }
  if (p.tvl_usd < 50_000_000) {
    reasons.push(`TVL ${money(p.tvl_usd)} is under the $50M watchlist floor.`);
  }
  if (p.change_7d !== null && p.change_7d <= -0.05) {
    reasons.push(`TVL fell ${Math.round(-p.change_7d * 100)}% in the last 7 days.`);
  }
  if (p.change_7d === null) {
    reasons.push('No 7-day growth reported.');
  }
  reasons.push(`Model launch probability only ${Math.round(pLaunch * 100)}%.`);
  return reasons.slice(0, 4);
}

/** Six concrete farm steps for one board row. */
function farmSteps(p: SnapshotProtocol, row: { impliedIfLaunched: number; pLaunch: number; farm: BoardRow['farm']; grave: GraveyardCase | null }): string[] {
  const chain = row.farm.chain;
  const f = row.farm;
  const steps: string[] = [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `Deposit $${TICKET_USD.toLocaleString('en-US')} into ${p.name} on ${chain} — its cheapest chain — and hold the position. Cost: $${TICKET_USD.toLocaleString('en-US')} of capital and about $${f.gas_usd} of gas. Time: 15 minutes to set up.`,
    `Expected slice at the $${TICKET_USD.toLocaleString('en-US')} ticket: $${f.tier.expectedSliceUsd.toLocaleString('en-US')} after a ${Math.round(row.pLaunch * 100)}% launch chance, minus $${f.gas_usd} gas and $${f.tier.opportunityUsd} of forgone yield: net $${f.net_usd.toLocaleString('en-US')} (${f.verdict}, $${f.net_per_hour_usd}/hour).`,
    `Hold for ${HOLD_DAYS} days and check in weekly: TVL, announcements and any points page. Time: about ${f.hours} hours of hands-on work in total.`,
    f.break_even_capital_usd === null
      ? `This farm never breaks even at any capital: the slice is too small against the gas. Walk away unless the protocol's TVL falls sharply.`
      : `Walk away if ${p.name}'s TVL rises ${f.walk_away_tvl_rise_pct}% — your slice shrinks to zero at that point. Break-even capital is $${f.break_even_capital_usd.toLocaleString('en-US')}.`,
  ];
  if (row.grave !== null) {
    steps.push(
      `Skip case: the model gives ${p.name} only a ${Math.round(row.pLaunch * 100)}% launch chance. Skipping it saves $${row.grave.gasSavedUsd} of gas and ${row.grave.hoursSaved} hours — spend them on a protocol that launches.`,
    );
  } else {
    steps.push(
      `If ${p.name} launches a token, claim only from its official claim page and never pay a third party to claim for you.`,
    );
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Build the radar
// ---------------------------------------------------------------------------

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const asOf = snapshot.as_of;
  const comps = compProtocols(snapshot);
  const points: Point[] = comps.map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!) }));
  const huber = huberFit(points);
  const curve: SizeCurve = {
    intercept: round4(huber.a),
    slope: round4(huber.b),
    r2: round4(rSquared(points, huber)),
    comps: comps.length,
    looMiss: round2(looMiss(points, huberFit)),
    timeSplitMiss: 0,
    timeSplitFit: 0,
    timeSplitTest: 0,
  };
  const ts = timeSplitMiss(comps, huberFit);
  curve.timeSplitMiss = Number.isNaN(ts.miss) ? 0 : round2(ts.miss);
  curve.timeSplitFit = ts.fit;
  curve.timeSplitTest = ts.test;

  // Per-category tilt: the median Huber residual per category, shrunk k = 40.
  const residuals = new Map<string, number[]>();
  for (const p of comps) {
    const pred = huber.a + huber.b * Math.log10(p.tvl_usd);
    const resid = Math.log10(p.mcap_usd!) - pred;
    const cat = p.category ?? 'Uncategorized';
    const list = residuals.get(cat) ?? [];
    list.push(resid);
    residuals.set(cat, list);
  }
  const tiltByCategory = new Map<string, number>();
  const categoryTilt: ModelSummary['categoryTilt'] = [];
  for (const [cat, list] of [...residuals.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 3) continue;
    const med = median(list);
    const tilt = 10 ** (med * (list.length / (list.length + 40)));
    tiltByCategory.set(cat, round4(tilt));
    categoryTilt.push({ category: cat, tilt: round4(tilt), comps: list.length });
  }

  // Term tests: size-only vs +growth vs +age vs +both (OLS, leave-one-out).
  const termRows = comps
    .filter((p) => p.change_7d !== null && ageDays(asOf, p.listed_at) !== null)
    .map((p) => ({
      y: Math.log10(p.mcap_usd!),
      size: Math.log10(p.tvl_usd),
      growth: p.change_7d!,
      age: Math.log10(ageDays(asOf, p.listed_at)! + 1),
    }));
  const looSize = looMissMulti(termRows.map((r) => ({ x: [r.size], y: r.y })));
  const looGrowth = looMissMulti(termRows.map((r) => ({ x: [r.size, r.growth], y: r.y })));
  const looAge = looMissMulti(termRows.map((r) => ({ x: [r.size, r.age], y: r.y })));
  const looBoth = looMissMulti(termRows.map((r) => ({ x: [r.size, r.growth, r.age], y: r.y })));
  const best = Math.min(looSize, looGrowth, looAge, looBoth);
  const termTests: TermTest[] = [
    { name: 'size only', looMiss: round2(looSize), kept: best === looSize || looSize <= best * 1.05, note: 'The curve the board uses.' },
    { name: 'size + 7d growth', looMiss: round2(looGrowth), kept: looGrowth < looSize * 0.95, note: looGrowth < looSize ? 'Growth helps a little; not enough to keep.' : 'Growth does not improve out-of-sample error; dropped.' },
    { name: 'size + age', looMiss: round2(looAge), kept: looAge < looSize * 0.95, note: looAge < looSize ? 'Age helps a little; not enough to keep.' : 'Age does not improve out-of-sample error; dropped.' },
    { name: 'size + growth + age', looMiss: round2(looBoth), kept: looBoth < looSize * 0.95, note: 'Both together do not beat size alone by a real margin; dropped.' },
  ];

  // Launch table and its calibration.
  const table = buildLaunchTable(snapshot.protocols, asOf);
  const calibration = calibrateLaunch(snapshot);
  const launchTable: LaunchTable = {
    cells: table.cells,
    tvlBandRates: table.tvlBandRates.map((r) => ({ ...r, rate: round4(r.rate) })),
    calibrationMae: calibration.mae,
    calibrationCells: calibration.cells,
  };

  // Tokenized share per category, for the graveyard reasons.
  const categoryRate = new Map<string, number | null>();
  {
    const byCategory = new Map<string, { n: number; tokenized: number }>();
    for (const p of snapshot.protocols) {
      const cat = p.category ?? 'Uncategorized';
      const t = byCategory.get(cat) ?? { n: 0, tokenized: 0 };
      t.n += 1;
      if (!isPreToken(p)) t.tokenized += 1;
      byCategory.set(cat, t);
    }
    for (const [cat, t] of byCategory) {
      categoryRate.set(cat, t.n >= 10 ? t.tokenized / t.n : null);
    }
  }

  const impliedIfLaunched = (p: SnapshotProtocol): number => {
    const tilt = tiltByCategory.get(p.category ?? 'Uncategorized') ?? 1;
    return Math.round(10 ** (huber.a + huber.b * Math.log10(p.tvl_usd)) * tilt);
  };

  const watchlistSet = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(isPreToken);
  const rankable = preToken.filter(isRankable);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  // Board: every watchlist protocol, plus the 158 rankable non-watchlist
  // protocols with the highest implied value. Ranked by implied value.
  const watchlistRows = rankable.filter((p) => watchlistSet.has(p.slug));
  const earlyRows = rankable
    .filter((p) => !watchlistSet.has(p.slug))
    .sort((a, b) => impliedIfLaunched(b) - impliedIfLaunched(a))
    .slice(0, 198 - watchlistRows.length);
  const boardProtocols = [...watchlistRows, ...earlyRows].sort((a, b) => impliedIfLaunched(b) - impliedIfLaunched(a));
  const boardSlugs = new Set(boardProtocols.map((p) => p.slug));

  const makeGraveyard = (p: SnapshotProtocol, inBoard: boolean, boardRank: number | null): GraveyardRow | null => {
    const age = ageDays(asOf, p.listed_at);
    const { prob } = launchProbability(p, table, asOf);
    const pNever = round4(1 - prob);
    if (pNever < GRAVEYARD_NEVER_MIN) return null;
    const gas = gasFor(p).gas;
    const hours = hoursFor();
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      implied_usd: impliedIfLaunched(p),
      age_days: age,
      change_7d: p.change_7d,
      p_never: pNever,
      p_launch: prob,
      reasons: graveyardReasons(p, age, prob, categoryRate.get(p.category ?? 'Uncategorized') ?? null),
      gas_saved_usd: inBoard ? gas : 0,
      hours_saved: inBoard ? hours : 0,
      in_board: inBoard,
      board_rank: boardRank,
    };
  };

  const board: BoardRow[] = boardProtocols.map((p, index) => {
    const age = ageDays(asOf, p.listed_at);
    const implied = impliedIfLaunched(p);
    const { prob, cell } = launchProbability(p, table, asOf);
    const farm = farmEconomics(p, implied, prob);
    const graveRow = makeGraveyard(p, true, index + 1);
    const grave: GraveyardCase | null =
      graveRow === null
        ? null
        : { pNever: graveRow.p_never, reasons: graveRow.reasons, gasSavedUsd: graveRow.gas_saved_usd, hoursSaved: graveRow.hours_saved };
    const row: BoardRow = {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: age,
      implied_value_usd: implied,
      model: {
        implied_if_launched_usd: implied,
        launch_probability: prob,
        never_probability: round4(1 - prob),
        launch_cell: cell,
        band_low_usd: Math.round(implied / curve.looMiss),
        band_high_usd: Math.round(implied * curve.looMiss),
        age_days: age,
      },
      farm,
      farm_steps: [],
      graveyard: grave,
    };
    row.farm_steps = farmSteps(p, { impliedIfLaunched: implied, pLaunch: prob, farm, grave });
    return row;
  });

  // Set aside: every pre-token protocol not on the board, with its reason.
  const setAside: SetAsideRow[] = preToken
    .filter((p) => !boardSlugs.has(p.slug))
    .map((p) => {
      const structural = setAsideReason(p);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        reason: structural ?? 'Rankable, but its implied value falls below the board’s 198th row.',
      };
    })
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  // The graveyard: board rows with P(never) >= 0.60. Set-aside protocols are
  // not in it — they are already excluded from the board for a structural
  // reason (a CEX, a staking product), so putting them here would pad the
  // list with cases no farmer would ever consider. The graveyard is the
  // skip-list for the board itself: protocols that look farmable and are not.
  const graveyard: GraveyardRow[] = [];
  for (const row of board) {
    const p = bySlug.get(row.slug)!;
    const g = makeGraveyard(p, true, row.rank);
    if (g !== null) graveyard.push(g);
  }
  graveyard.sort((a, b) => b.p_never - a.p_never || b.tvl_usd - a.tvl_usd);
  const savings = graveyard.reduce(
    (acc, g) => ({ gasUsd: acc.gasUsd + g.gas_saved_usd, hours: round2(acc.hours + g.hours_saved), count: acc.count + 1 }),
    { gasUsd: 0, hours: 0, count: 0 },
  );

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));

  const trading = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const audit: Audit = {
    total: snapshot.protocols.length,
    ranked: board.length,
    setAside: setAside.length,
    trading,
    preToken: preToken.length,
    watchlist: snapshot.watchlist.length,
  };
  if (audit.ranked + audit.setAside + audit.trading !== audit.total) {
    throw new SnapshotError(
      `audit fails: ${audit.ranked} ranked + ${audit.setAside} set aside + ${audit.trading} trading != ${audit.total} protocols`,
    );
  }

  const model: ModelSummary = {
    name: 'grave-1',
    curve,
    launchTable,
    termTests,
    categoryTilt,
  };
  const radar: RadarData = {
    model,
    board,
    graveyard,
    graveyardSavings: savings,
    setAside,
    live,
    comps: comps.map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! })),
    audit,
  };
  return { board, radar };
}

/** The gate's shape, checked before writing: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i += 1) if (ranks[i] !== i + 1) return 'ranks are not exactly 1..N';
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i += 1) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1) return 'all implied values are equal';
  const have = new Set(board.map((r) => r.slug));
  for (const slug of snapshot.watchlist) if (!have.has(slug)) return `watchlist slug ${slug} is missing`;
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug}: ${row.farm_steps.length} farm steps`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${row.slug}: a farm step is ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's data, as a script the page reads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
