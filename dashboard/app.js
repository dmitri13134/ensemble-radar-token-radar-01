// Ensemble Radar dashboard: renders window.RADAR (written by main.ts)
// with no network. Filters, sorting, search and a detail view per row.
// Hash routes: #detail=<slug> opens a protocol, #filtered applies the
// preset filter (ensemble >= 45, sorted by ensemble) used for the filtered screenshot.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const money = (n) => {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  return '$' + Math.round(n / 1e3) + 'K';
};
const pct = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const rows = D.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

$('meta').innerHTML = '<b>' + rows.length + '</b>protocols ranked · ' + D.watchlist_size +
  ' on the watchlist · ' + D.early_size + ' early finds · snapshot ' + esc(D.as_of);
$('modelVer').textContent = D.model_version;
$('asOf').textContent = D.as_of;

const cats = [...new Set(rows.map((r) => r.category || 'No category'))].sort();
for (const c of cats) $('cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
for (const c of chains) $('chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>');

function current() {
  let list = rows.filter((r) => {
    const q = $('q').value.trim().toLowerCase();
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if ($('cat').value && (r.category || 'No category') !== $('cat').value) return false;
    if ($('chain').value && !r.chains.includes($('chain').value)) return false;
    if ($('cons').value && r.signals.consensus !== $('cons').value) return false;
    if (r.signals.ensemble < Number($('minEns').value)) return false;
    return true;
  });
  const s = $('sort').value;
  const by = {
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    ensemble: (a, b) => b.signals.ensemble - a.signals.ensemble,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    momentum: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    spread: (a, b) => b.signals.spread - a.signals.spread,
  }[s];
  return list.sort(by);
}

function render() {
  const list = current();
  $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown';
  $('rows').innerHTML = list.map((r) => {
    const chg = r.change_7d === null ? '<span class="flat">—</span>'
      : '<span class="' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat') + '">' + pct(r.change_7d) + '</span>';
    return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td><strong>' + esc(r.name) +
      '</strong><br><small style="color:#9a9aa8">' + esc(r.slug) + '</small></td><td>' + esc(r.category || '—') +
      '</td><td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') +
      '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + chg + '</td><td><span class="bar"><i style="width:' +
      r.signals.ensemble + '%"></i></span>' + r.signals.ensemble.toFixed(0) + '</td><td class="num"><strong>' +
      money(r.implied_value_usd) + '</strong></td><td><span class="tag ' + r.signals.consensus + '">' +
      r.signals.consensus + '</span></td></tr>';
  }).join('');
  for (const tr of document.querySelectorAll('#rows tr')) {
    tr.addEventListener('click', () => showDetail(tr.dataset.slug));
  }
}

const SIG_LABELS = [
  ['scale', 'Scale — log TVL'],
  ['momentum', 'Momentum — 7d change'],
  ['tenure', 'Tenure — time with no token'],
  ['breadth', 'Breadth — chains'],
  ['peer', 'Peer — category multiple'],
];

function showDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  $('detail').hidden = false;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === slug));
  $('dName').textContent = '#' + r.rank + ' ' + r.name;
  $('dMeta').innerHTML = 'Implied value <strong>' + money(r.implied_value_usd) + '</strong> · TVL ' + money(r.tvl_usd) +
    ' · 7d ' + pct(r.change_7d) + ' · ' + (r.age_days === null ? 'age unlisted' : r.age_days + ' days listed') +
    ' · ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' · category peer multiple ' +
    r.peer_multiple.toFixed(2) + 'x · ensemble ' + r.signals.ensemble.toFixed(1) +
    ' · signals <span class="tag ' + r.signals.consensus + '">' + r.signals.consensus + '</span> (spread ' +
    r.signals.spread.toFixed(0) + ')';
  $('dSignals').innerHTML = SIG_LABELS.map(([k, label]) =>
    '<div class="sig"><b>' + label + '</b><span class="v">' + r.signals[k].toFixed(0) + '</span>' +
    '<span class="bar"><i style="width:' + r.signals[k] + '%"></i></span><small>weight ' +
    Math.round(D.weights[k] * 100) + '%</small></div>').join('') +
    '<div class="sig"><b>Ensemble</b><span class="v">' + r.signals.ensemble.toFixed(1) + '</span>' +
    '<span class="bar"><i style="width:' + r.signals.ensemble + '%"></i></span><small>weighted blend of the five</small></div>';
  $('dSteps').innerHTML = r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('');
  if (!document.body.classList.contains('detail-only')) $('detail').scrollIntoView({ block: 'nearest' });
}

$('dClose').addEventListener('click', () => {
  $('detail').hidden = true;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.remove('sel'));
  history.replaceState(null, '', location.pathname);
});

for (const id of ['q', 'cat', 'chain', 'cons', 'minEns', 'sort']) {
  $(id).addEventListener('input', render);
}
$('minEns').addEventListener('input', () => { $('minEnsOut').textContent = $('minEns').value; });
$('reset').addEventListener('click', () => {
  $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('cons').value = '';
  $('minEns').value = 0; $('minEnsOut').textContent = '0'; $('sort').value = 'value';
  history.replaceState(null, '', location.pathname);
  $('detail').hidden = true;
  render();
});

$('liveRows').innerHTML = D.live.map((p) =>
  '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.category || '—') + '</td><td class="num">' +
  money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd || 0) + '</td><td class="num">' +
  p.multiple.toFixed(2) + 'x</td></tr>').join('');

render();
if (location.hash.startsWith('#detail=')) {
  document.body.classList.add('detail-only');
  showDetail(decodeURIComponent(location.hash.slice(8)));
} else if (location.hash === '#filtered') {
  $('minEns').value = 45;
  $('minEnsOut').textContent = '45';
  $('sort').value = 'ensemble';
  render();
}
