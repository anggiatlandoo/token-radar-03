'use strict';
/* Graveyard Radar dashboard: reads window.RADAR (written by main.ts) and
   renders three views — the graveyard, the board, the model — plus a detail
   drawer. Hash-routed, so a screenshot can open any view directly. */
const R = window.RADAR;
const $ = (s) => document.querySelector(s);

function money(n) {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(n);
}
function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
function ageText(days) {
  if (days == null) return 'unknown';
  if (days < 365) return Math.round(days / 30) + ' mo';
  return (days / 365).toFixed(1) + ' y';
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function pill(v) { return '<span class="pill ' + v + '">' + v + '</span>'; }

const state = { view: 'graveyard', gSort: 'p_never', gDir: -1, bSort: 'implied_value_usd', bDir: -1, gCat: '', gQ: '', bVerdict: '', bCat: '', bQ: '' };

function parseHash() {
  const raw = (location.hash || '#/graveyard').slice(1);
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { view: parts[0] || 'graveyard', slug: parts[1] || null, params };
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  const el = $('#view-' + view);
  if (el) el.classList.add('active');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  if (view === 'graveyard') renderGraveyard();
  if (view === 'board') renderBoard();
  if (view === 'model') renderModel();
}

function openDetail(slug) {
  const row = R.board.find((r) => r.slug === slug) || null;
  const grave = R.graveyard.find((g) => g.slug === slug) || null;
  const aside = R.setAside.find((s) => s.slug === slug) || null;
  const d = $('#drawer');
  if (!row && !grave) { d.hidden = true; return; }
  const name = row ? row.name : grave.name;
  const cat = row ? row.category : grave.category;
  const tvl = row ? row.tvl_usd : grave.tvl_usd;
  const age = row ? row.age_days : grave.age_days;
  const change = row ? row.change_7d : grave.change_7d;
  const implied = row ? row.implied_value_usd : grave.implied_usd;
  const pLaunch = row ? row.model.launch_probability : grave.p_launch;
  const pNever = row ? row.model.never_probability : grave.p_never;
  let h = '<button class="close" id="drawer-close">Close</button>';
  h += '<h2>' + esc(name) + '</h2>';
  h += '<p class="sub">' + esc(cat || 'Uncategorized') + ' &middot; ' + esc((row ? row.chains : []).join(', ') || 'chains unlisted') + '</p>';
  if (grave) {
    h += '<p><span class="pill grave">GRAVEYARD &middot; P(never) ' + pct(pNever) + '</span></p>';
    h += '<h3>Why it will probably never launch</h3>';
    h += grave.reasons.map((r) => '<span class="reason">' + esc(r) + '</span>').join('');
    if (grave.in_board) {
      h += '<p><b>Skipping it saves $' + grave.gas_saved_usd + ' of gas and ' + grave.hours_saved + ' hours.</b></p>';
    } else {
      h += '<p class="sub">Set aside from the board' + (aside ? ': ' + esc(aside.reason) : '') + ' — no saving counted for it, because no farmer would farm it anyway.</p>';
    }
  }
  h += '<h3>Value, if it launched</h3><dl class="kv">';
  h += '<dt>Implied value</dt><dd>' + money(implied) + (row ? ' (band ' + money(row.model.band_low_usd) + ' – ' + money(row.model.band_high_usd) + ')' : '') + '</dd>';
  h += '<dt>TVL</dt><dd>' + money(tvl) + '</dd>';
  h += '<dt>Age</dt><dd>' + ageText(age) + '</dd>';
  h += '<dt>7-day change</dt><dd>' + (change == null ? 'unreported' : (change >= 0 ? '+' : '') + (change * 100).toFixed(1) + '%') + '</dd>';
  h += '<dt>P(launch)</dt><dd>' + pct(pLaunch) + (row ? ' &middot; cell ' + esc(row.model.launch_cell) : '') + '</dd>';
  h += '<dt>P(never)</dt><dd>' + pct(pNever) + '</dd></dl>';
  if (row) {
    const f = row.farm;
    h += '<h3>Farm economics ($1,000 ticket)</h3><dl class="kv">';
    h += '<dt>Verdict</dt><dd>' + pill(f.verdict) + '</dd>';
    h += '<dt>Expected slice</dt><dd>$' + f.tier.expectedSliceUsd.toLocaleString('en-US') + '</dd>';
    h += '<dt>Gas (' + esc(f.chain) + ')</dt><dd>$' + f.gas_usd + '</dd>';
    h += '<dt>Net</dt><dd>$' + f.net_usd.toLocaleString('en-US') + ' (' + (f.net_per_hour_usd >= 0 ? '+' : '') + '$' + f.net_per_hour_usd + '/hour)</dd>';
    h += '<dt>Break-even capital</dt><dd>' + (f.break_even_capital_usd == null ? 'never' : '$' + f.break_even_capital_usd.toLocaleString('en-US')) + '</dd>';
    h += '<dt>Walk away if</dt><dd>TVL rises ' + f.walk_away_tvl_rise_pct + '%</dd></dl>';
    h += '<h3>Farm plan</h3><ol class="steps">' + row.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
  }
  d.innerHTML = h;
  d.hidden = false;
  $('#drawer-close').addEventListener('click', () => { d.hidden = true; });
}
function closeDetail() { $('#drawer').hidden = true; }

function renderSavings() {
  const s = R.graveyardSavings;
  const top20 = R.graveyard.filter((g) => g.board_rank !== null && g.board_rank <= 20).length;
  $('#savings').innerHTML =
    '<div><b>$' + s.gasUsd + '</b><span>gas saved</span></div>' +
    '<div><b>' + s.hours + ' h</b><span>hours saved</span></div>' +
    '<div><b>' + s.count + '</b><span>protocols in the graveyard</span></div>' +
    '<div><b>' + top20 + '</b><span>of them in the board&rsquo;s top 20</span></div>';
  $('#audit-line').textContent =
    'Audit: ' + R.audit.total + ' protocols accounted for — ' + R.audit.ranked + ' ranked, ' +
    R.audit.setAside + ' set aside with reasons, ' + R.audit.trading + ' already trading.';
}

function categoriesOf(rows) {
  return [...new Set(rows.map((r) => r.category || 'Uncategorized'))].sort();
}
function sortRows(rows, key, dir, get) {
  const val = get || ((r) => r[key]);
  // Ties return 0: the sort is stable, so rows keep the order they arrived
  // in — the model's order (graveyard rank, or board rank). Breaking ties
  // by name instead scrambled the rank column.
  return [...rows].sort((a, b) => {
    const av = val(a) ?? -Infinity;
    const bv = val(b) ?? -Infinity;
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * dir;
  });
}
function boardVal(key) {
  return (r) => (key === 'launch_probability' ? r.model.launch_probability : key === 'net_per_hour_usd' ? r.farm.net_per_hour_usd : r[key]);
}
function matches(row, q, cat) {
  const hay = (row.name + ' ' + (row.category || '')).toLowerCase();
  return (!q || hay.includes(q.toLowerCase())) && (!cat || (row.category || 'Uncategorized') === cat);
}

function renderGraveyard() {
  const el = $('#view-graveyard');
  const cats = categoriesOf(R.graveyard);
  let rows = R.graveyard.filter((g) => matches(g, state.gQ, state.gCat));
  rows = sortRows(rows, state.gSort, state.gDir);
  el.innerHTML =
    '<h2>The Graveyard</h2>' +
    '<p class="lede">Protocols ranked by P(never) — the model\u2019s forward-looking chance they never launch a token. ' +
    'An old protocol that has not launched scores high, because its cohort has mostly launched already; a young one scores low, because it still has time. ' +
    'The top of this list is where farmers burn gas and hours for nothing. Skip it, and the savings above are yours.</p>' +
    '<div class="toolbar"><select id="g-cat"><option value="">All categories</option>' +
    cats.map((c) => '<option value="' + esc(c) + '"' + (state.gCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '</select><input id="g-q" type="search" placeholder="Search a protocol\u2026" value="' + esc(state.gQ) + '">' +
    '<span class="count">' + rows.length + ' of ' + R.graveyard.length + ' shown</span></div>' +
    '<table><thead><tr>' +
    '<th data-sort="p_never">#</th><th>Protocol</th><th data-sort="tvl_usd">TVL</th><th data-sort="age_days">Age</th>' +
    '<th data-sort="p_never">P(never)</th><th>Why</th><th data-sort="gas_saved_usd" class="num">Gas saved</th><th data-sort="hours_saved" class="num">Hours saved</th>' +
    '</tr></thead><tbody>' +
    rows.map((g, i) => {
      const rank = R.graveyard.indexOf(g) + 1;
      return '<tr data-slug="' + esc(g.slug) + '"><td>' + rank + '</td>' +
        '<td><span class="name">' + esc(g.name) + '</span><br><span class="sub">' + esc(g.category || 'Uncategorized') + (g.in_board ? '' : ' &middot; set aside') + '</span></td>' +
        '<td class="num">' + money(g.tvl_usd) + '</td><td>' + ageText(g.age_days) + '</td>' +
        '<td><div class="bar"><i style="width:' + Math.round(g.p_never * 100) + '%"></i></div>' + pct(g.p_never) + '</td>' +
        '<td><span class="reason">' + esc(g.reasons[0] || '') + '</span></td>' +
        '<td class="num">$' + g.gas_saved_usd + '</td><td class="num">' + g.hours_saved + ' h</td></tr>';
    }).join('') + '</tbody></table>';
  $('#g-cat').addEventListener('change', (e) => { state.gCat = e.target.value; renderGraveyard(); });
  $('#g-q').addEventListener('input', (e) => { state.gQ = e.target.value; renderGraveyard(); });
  el.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.gSort === k) state.gDir *= -1; else { state.gSort = k; state.gDir = -1; }
      renderGraveyard();
    });
  });
  el.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
}

function renderBoard() {
  const el = $('#view-board');
  const cats = categoriesOf(R.board);
  let rows = R.board.filter((r) => matches(r, state.bQ, state.bCat) && (!state.bVerdict || r.farm.verdict === state.bVerdict));
  rows = sortRows(rows, state.bSort, state.bDir, boardVal(state.bSort));
  el.innerHTML =
    '<h2>The Board</h2>' +
    '<p class="lede">The 198 pre-token protocols, ranked by implied value if they launched. ' +
    'The verdict is the hourly wage the farm pays at a $1,000 ticket: ROBUST $10+/h, FARM $5+/h, THIN above $0, SKIP at or below $0.</p>' +
    '<div class="toolbar"><select id="b-verdict"><option value="">All verdicts</option>' +
    ['ROBUST', 'FARM', 'THIN', 'SKIP'].map((v) => '<option' + (state.bVerdict === v ? ' selected' : '') + '>' + v + '</option>').join('') +
    '</select><select id="b-cat"><option value="">All categories</option>' +
    cats.map((c) => '<option value="' + esc(c) + '"' + (state.bCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '</select><input id="b-q" type="search" placeholder="Search a protocol\u2026" value="' + esc(state.bQ) + '">' +
    '<span class="count">' + rows.length + ' of ' + R.board.length + ' shown</span></div>' +
    '<table><thead><tr>' +
    '<th>Rank</th><th>Protocol</th><th data-sort="tvl_usd">TVL</th><th data-sort="implied_value_usd">Implied</th>' +
    '<th data-sort="launch">P(launch)</th><th>Band</th><th>Verdict</th><th data-sort="netPerHour" class="num">Net / hour</th>' +
    '</tr></thead><tbody>' +
    rows.map((r) => {
      const grave = r.graveyard ? ' <span class="pill grave">GRAVEYARD</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + grave + '<br><span class="sub">' + esc(r.category || 'Uncategorized') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.implied_value_usd) + '</td>' +
        '<td>' + pct(r.model.launch_probability) + '</td>' +
        '<td class="num">' + money(r.model.band_low_usd) + ' – ' + money(r.model.band_high_usd) + '</td>' +
        '<td>' + pill(r.farm.verdict) + '</td>' +
        '<td class="num">' + (r.farm.net_per_hour_usd >= 0 ? '+' : '') + '$' + r.farm.net_per_hour_usd + '</td></tr>';
    }).join('') + '</tbody></table>';
  $('#b-verdict').addEventListener('change', (e) => { state.bVerdict = e.target.value; renderBoard(); });
  $('#b-cat').addEventListener('change', (e) => { state.bCat = e.target.value; renderBoard(); });
  $('#b-q').addEventListener('input', (e) => { state.bQ = e.target.value; renderBoard(); });
  el.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort === 'launch' ? 'launch_probability' : th.dataset.sort === 'netPerHour' ? 'net_per_hour_usd' : th.dataset.sort;
      if (state.bSort === k) state.bDir *= -1; else { state.bSort = k; state.bDir = -1; }
      renderBoard();
    });
  });
  el.querySelectorAll('tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
}

function scatterSvg() {
  const W = 640; const H = 320; const ML = 46; const MR = 12; const MT = 12; const MB = 34;
  const xs = R.comps.map((c) => Math.log10(c.tvl));
  const ys = R.comps.map((c) => Math.log10(c.mcap));
  const x0 = Math.floor(Math.min(...xs)); const x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys)); const y1 = Math.ceil(Math.max(...ys));
  const X = (x) => ML + ((x - x0) / (x1 - x0)) * (W - ML - MR);
  const Y = (y) => MT + (1 - (y - y0) / (y1 - y0)) * (H - MT - MB);
  const a = R.model.curve.intercept; const b = R.model.curve.slope;
  const band = Math.log10(R.model.curve.looMiss);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Live-token comps against the fitted size curve">';
  s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fffdf7"/>';
  for (let gx = x0; gx <= x1; gx += 1) {
    s += '<line x1="' + X(gx) + '" y1="' + MT + '" x2="' + X(gx) + '" y2="' + (H - MB) + '" stroke="#e2d9c6"/>';
    s += '<text x="' + X(gx) + '" y="' + (H - MB + 16) + '" font-size="10" fill="#6b5f4f" text-anchor="middle">10^' + gx + '</text>';
  }
  for (let gy = y0; gy <= y1; gy += 1) {
    s += '<line x1="' + ML + '" y1="' + Y(gy) + '" x2="' + (W - MR) + '" y2="' + Y(gy) + '" stroke="#e2d9c6"/>';
    s += '<text x="' + (ML - 6) + '" y="' + (Y(gy) + 3) + '" font-size="10" fill="#6b5f4f" text-anchor="end">10^' + gy + '</text>';
  }
  s += '<polygon points="' + X(x0) + ',' + Y(a + b * x0 + band) + ' ' + X(x1) + ',' + Y(a + b * x1 + band) + ' ' + X(x1) + ',' + Y(a + b * x1 - band) + ' ' + X(x0) + ',' + Y(a + b * x0 - band) + '" fill="#7a1f1f" opacity="0.08"/>';
  s += '<line x1="' + X(x0) + '" y1="' + Y(a + b * x0) + '" x2="' + X(x1) + '" y2="' + Y(a + b * x1) + '" stroke="#7a1f1f" stroke-width="2"/>';
  for (let i = 0; i < R.comps.length; i += 1) {
    s += '<circle cx="' + X(xs[i]).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="2.6" fill="#2f6fb2" opacity="0.65"/>';
  }
  s += '<text x="' + ML + '" y="' + (H - 8) + '" font-size="10" fill="#6b5f4f">TVL (log10 USD) &rarr;</text>';
  s += '<text x="' + (W - MR) + '" y="' + (MT + 8) + '" font-size="10" fill="#6b5f4f" text-anchor="end">market cap (log10 USD)</text></svg>';
  return s;
}

function renderModel() {
  const el = $('#view-model');
  const m = R.model;
  const v = (name, n) => '<div class="card"><b>' + n + '</b><span>' + name + '</span></div>';
  el.innerHTML =
    '<h2>The Model</h2>' +
    '<p class="lede">How the radar is built, what it was tested against, and where it is honest about its limits. ' +
    'Growth and age were tested as fitted terms and dropped: they did not improve out-of-sample error.</p>' +
    '<div class="cards">' +
    v('live-token comps', m.curve.comps) + v('R&sup2; of the size curve', m.curve.r2) +
    v('LOO median miss', '&times;' + m.curve.looMiss) + v('time-split miss', '&times;' + m.curve.timeSplitMiss) +
    v('launch calibration MAE', m.launchTable.calibrationMae) + v('graveyard protocols', R.graveyard.length) +
    '</div>' +
    '<div class="panel"><h3>The size curve</h3>' +
    '<p class="mono">log10(market cap) = ' + m.curve.intercept + ' + ' + m.curve.slope + ' &times; log10(TVL)</p>' +
    '<p>Fitted by Huber robust regression over ' + m.curve.comps + ' live-token protocols (exchanges excluded), ' +
    'with a per-category tilt shrunk toward zero (k = 40). The band is the leave-one-out median miss, &times;' + m.curve.looMiss + '.</p>' +
    scatterSvg() + '</div>' +
    '<div class="panel"><h3>Validation</h3><table class="plain"><thead><tr><th>Test</th><th>Result</th><th>What it means</th></tr></thead><tbody>' +
    '<tr><td>Leave-one-out</td><td>&times;' + m.curve.looMiss + ' median miss</td><td>Refit without each comp in turn; the typical prediction is off by this factor.</td></tr>' +
    '<tr><td>Time-split</td><td>&times;' + m.curve.timeSplitMiss + ' (' + m.curve.timeSplitFit + ' fit / ' + m.curve.timeSplitTest + ' test)</td><td>Fit on tokens listed before 2025, tested on those listed after.</td></tr>' +
    '<tr><td>Launch calibration</td><td>MAE ' + m.launchTable.calibrationMae + ' over ' + m.launchTable.calibrationCells + ' cells</td><td>The cumulative table is fit on protocols listed before Jun 2025 and checked on those listed after. Newer protocols have had less time to launch, so the table over-predicts for them — that is the survivor-bias caveat, measured. P(launch) is then derived forward from the table, not read off it.</td></tr>' +
    m.termTests.map((t) => '<tr><td>' + esc(t.name) + '</td><td>&times;' + t.looMiss + ' (' + (t.kept ? 'kept' : 'dropped') + ')</td><td>' + esc(t.note) + '</td></tr>').join('') +
    '</tbody></table><p class="sub">Term tests are OLS fits, so their LOO differs from the Huber curve\u2019s &times;' + m.curve.looMiss + ' — the comparison is within the four OLS rows, not against the curve.</p></div>' +
    '<div class="panel"><h3>Launch table — share already tokenized, by age &times; TVL</h3>' +
    '<table class="plain"><thead><tr><th>Age</th><th>TVL</th><th class="num">n</th><th class="num">P(launch)</th></tr></thead><tbody>' +
    m.launchTable.cells.map((c) => '<tr><td>' + esc(c.ageBand) + '</td><td>' + esc(c.tvlBand) + '</td><td class="num">' + c.n + '</td><td class="num">' + Math.round(c.rate * 100) + '%</td></tr>').join('') +
    '</tbody></table><p class="sub">Shrunk toward the TVL-band rate (k = 5). These are cumulative shares, not forecasts: P(launch) is derived forward from them — the share of the cohort that launches after a protocol&rsquo;s age, divided by the share still pre-token at that age, plus a 5% late-launch tail after year 3. Unknown age is treated as old, because its table rate is high: those protocols mostly predate the tracker.</p></div>' +
    '<div class="panel"><h3>Audit — all 758 protocols</h3>' +
    '<p>' + R.audit.ranked + ' ranked on the board, ' + R.audit.setAside + ' set aside with reasons, ' + R.audit.trading + ' already trading. ' +
    R.audit.ranked + ' + ' + R.audit.setAside + ' + ' + R.audit.trading + ' = ' + R.audit.total + '.</p>' +
    '<h3>Set aside (' + R.setAside.length + ')</h3>' +
    '<table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th>Reason</th></tr></thead><tbody>' +
    R.setAside.map((s) => '<tr><td><span class="name">' + esc(s.name) + '</span></td><td class="num">' + money(s.tvl_usd) + '</td><td>' + esc(s.reason) + '</td></tr>').join('') +
    '</tbody></table></div>' +
    '<div class="panel"><h3>Already trading — largest 24 by market cap</h3>' +
    '<table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th></tr></thead><tbody>' +
    R.live.map((l) => '<tr><td><span class="name">' + esc(l.name) + '</span></td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td></tr>').join('') +
    '</tbody></table></div>';
}

function route() {
  const { view, slug, params } = parseHash();
  if (params.has('verdict')) state.bVerdict = params.get('verdict') || '';
  if (params.has('cat')) { state.gCat = params.get('cat') || ''; state.bCat = params.get('cat') || ''; }
  setView(['graveyard', 'board', 'model'].includes(view) ? view : 'graveyard');
  if (slug) openDetail(slug); else closeDetail();
}

renderSavings();
route();
window.addEventListener('hashchange', route);
