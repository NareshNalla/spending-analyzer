(function () {
  'use strict';

  const L = window.SpendLogic;
  const $ = s => document.querySelector(s);
  const CATS = L.categories();
  const COL = Object.fromEntries(CATS.map(c => [c.name, c.color]));
  const MARK = Object.fromEntries(CATS.map(c => [c.name, c.mark]));
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  const S = {
    txns: [],
    rules: {},
    mode: 'auto',
    q: '',
    cat: '',
    view: 'tx',
    sk: 'date',
    sd: -1,
    dateFrom: '',
    dateTo: '',
    amtMin: 0,
    amtMax: null,
    theme: 'auto',
    selectedMonth: '',
    section: 'spend',
    budgets: {},
    goals: [],
    similar: []
  };

  let chart = null;
  let chartSeq = 0;
  let chartPromise = null;
  let pdfPromise = null;
  let toastTimer = null;
  let undo = null;
  let planSig = '';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmt(n) {
    return money.format(Number.isFinite(n) ? n : 0);
  }

  function setMsg(text, kind) {
    const el = $('#msg');
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function snapshot() {
    return {
      t: S.txns,
      r: S.rules,
      m: S.mode,
      f: S.dateFrom,
      to: S.dateTo,
      amn: S.amtMin,
      amx: S.amtMax,
      th: S.theme,
      sm: S.selectedMonth,
      sec: S.section,
      v: S.view,
      b: S.budgets,
      g: S.goals,
      sr: S.similar
    };
  }

  function save() {
    try {
      localStorage.setItem(L.STORAGE_KEY, JSON.stringify(snapshot()));
      return true;
    } catch (e) {
      setMsg('This browser blocked local storage, so changes will disappear when you close the tab.', 'warn');
      return false;
    }
  }

  function applyPayload(d) {
    const migrated = L.migrate(d.t || [], d.r || {});
    S.txns = migrated.txns;
    S.rules = migrated.rules;
    S.mode = d.m === 'bank' || d.m === 'card' ? d.m : 'auto';
    S.dateFrom = d.f || '';
    S.dateTo = d.to || '';
    S.amtMin = Number.isFinite(Number(d.amn)) ? Number(d.amn) : 0;
    S.amtMax = (d.amx == null || Number(d.amx) === 999999) ? null : Number(d.amx);
    S.theme = d.th || 'auto';
    S.selectedMonth = d.sm || '';
    S.section = ['spend', 'budgets', 'goals', 'projections'].includes(d.sec) ? d.sec : 'spend';
    if (d.v === 'month') S.view = 'tx';
    else if (['tx', 'mer', 'cat'].includes(d.v)) S.view = d.v;
    S.budgets = L.normalizeBudgets(d.b);
    S.goals = L.normalizeGoals(d.g);
    S.similar = L.normalizeSimilar(d.sr);
    planSig = '';
    return migrated;
  }

  function syncControls() {
    $('#mode').value = S.mode;
    $('#theme').value = S.theme;
    $('#dateFrom').value = S.dateFrom;
    $('#dateTo').value = S.dateTo;
    $('#amtMin').value = S.amtMin ? String(S.amtMin) : '';
    $('#amtMax').value = S.amtMax == null ? '' : String(S.amtMax);
    const cat = $('#catFilter');
    if (cat && document.activeElement !== cat) cat.value = S.cat;
  }

  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(L.STORAGE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d) return;
    applyPayload(d);
    const merchantsChanged = (d.t || []).some((t, i) => !t.id || t.m !== S.txns[i].m);
    const rulesChanged = JSON.stringify(d.r || {}) !== JSON.stringify(S.rules);
    const storedMax = d.amx == null || d.amx === '' ? null : Number(d.amx);
    const maxChanged = storedMax !== S.amtMax;
    if (merchantsChanged || rulesChanged || maxChanged) save();
  }

  function applyTheme(pref) {
    const dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    S.theme = pref || 'auto';
    $('#theme').value = S.theme;
  }

  function themeColors() {
    const style = getComputedStyle(document.documentElement);
    const pick = name => style.getPropertyValue(name).trim();
    return { text: pick('--mut'), grid: pick('--grid'), income: pick('--pos'), spend: pick('--neg'), save: pick('--save') };
  }

  function periodMonths() {
    const seen = new Set();
    S.txns.forEach(t => {
      const month = String(t.date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) seen.add(month);
    });
    return [...seen].sort();
  }

  function ensurePeriod() {
    const months = periodMonths();
    if (!months.length) {
      S.selectedMonth = '';
      return;
    }
    if (!months.includes(S.selectedMonth)) S.selectedMonth = L.defaultPeriod(months, new Date());
  }

  function periodBounds() {
    if (!/^\d{4}-\d{2}$/.test(S.selectedMonth)) return { from: '', to: '' };
    return { from: S.selectedMonth + '-01', to: S.selectedMonth + '-31' };
  }

  function alignDatesToPeriod() {
    const bounds = periodBounds();
    if (!bounds.from) return;
    const from = S.dateFrom;
    const to = S.dateTo;
    const start = from || bounds.from;
    const end = to || bounds.to;
    if (start > bounds.to || end < bounds.from) {
      S.dateFrom = '';
      S.dateTo = '';
    } else {
      if (from && from < bounds.from) S.dateFrom = bounds.from;
      if (to && to > bounds.to) S.dateTo = bounds.to;
    }
    const fromEl = $('#dateFrom');
    const toEl = $('#dateTo');
    if (fromEl) {
      fromEl.min = bounds.from;
      fromEl.max = bounds.to;
      if (document.activeElement !== fromEl) fromEl.value = S.dateFrom;
    }
    if (toEl) {
      toEl.min = bounds.from;
      toEl.max = bounds.to;
      if (document.activeElement !== toEl) toEl.value = S.dateTo;
    }
    if (from !== S.dateFrom || to !== S.dateTo) save();
  }

  function currentView() {
    ensurePeriod();
    const decorated = L.decorate(S.txns, S.mode, S.rules);
    const bounds = periodBounds();
    const inPeriod = bounds.from
      ? decorated.rows.filter(t => t.date >= bounds.from && t.date <= bounds.to)
      : decorated.rows;
    let from = S.dateFrom;
    let to = S.dateTo;
    if (bounds.from) {
      if (!from || from < bounds.from) from = bounds.from;
      if (!to || to > bounds.to) to = bounds.to;
    }
    const filtered = L.filterRows(inPeriod, {
      q: S.q,
      cat: S.cat,
      dateFrom: from,
      dateTo: to,
      amtMin: S.amtMin,
      amtMax: S.amtMax
    });
    return { mode: decorated.mode, all: inPeriod, filtered, rows: decorated.rows, summary: L.summarize(filtered) };
  }

  function addTransactions(records, sourceName) {
    const seen = new Set(S.txns.map(t => t.date + '|' + t.desc + '|' + t.raw));
    let added = 0;
    let dupes = 0;
    records.forEach(r => {
      const desc = String(r.desc || '').trim();
      const key = r.date + '|' + desc + '|' + r.raw;
      if (!r.date || !desc || !Number.isFinite(r.raw) || seen.has(key)) {
        if (seen.has(key)) dupes++;
        return;
      }
      seen.add(key);
      const m = L.merchant(desc);
      S.txns.push({ id: L.uid(), date: r.date, desc, raw: r.raw, m, file: sourceName || '' });
      if (r.category && !S.rules[m]) {
        const known = L.canonicalCategory(r.category);
        if (known) S.rules[m] = known;
      }
      added++;
    });
    return { added, dupes };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function loadChart() {
    if (window.Chart) return Promise.resolve();
    if (!chartPromise) {
      chartPromise = loadScript('vendor/chart.min.js').then(() => {
        if (!window.Chart) throw new Error('Chart.js did not start');
      }).catch(err => { chartPromise = null; throw err; });
    }
    return chartPromise;
  }

  function loadPdf() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfPromise) {
      pdfPromise = loadScript('vendor/pdf.min.js').then(() => {
        if (!window.pdfjsLib) throw new Error('PDF.js did not start');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
        return window.pdfjsLib;
      }).catch(err => { pdfPromise = null; throw err; });
    }
    return pdfPromise;
  }

  async function readPdf(file) {
    const lib = await loadPdf();
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const rows = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, it: [] }; rows.push(row); }
        row.it.push({ x: it.transform[4], s: it.str });
      });
      rows.sort((a, b) => b.y - a.y).forEach(row => {
        lines.push(row.it.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim());
      });
    }
    const years = [...lines.join(' ').matchAll(/\b(20\d{2})\b/g)].map(m => +m[1]);
    const year = years.length ? Math.max(...years) : new Date().getFullYear();
    return L.parseStatementLines(lines, year);
  }

  async function ingest(files) {
    const notes = [];
    let added = 0;
    let failed = false;
    for (const file of files) {
      setMsg('Reading ' + file.name + '…', '');
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      try {
        if (!isCsv && !isPdf) {
          failed = true;
          notes.push(file.name + ': use a .csv or .pdf file.');
          continue;
        }
        let parsed;
        if (isCsv) parsed = L.parseCsv(await file.text());
        else parsed = { txns: await readPdf(file), skipped: 0, hint: 'This PDF may be a scan, or its layout was not recognized. A CSV export from the bank is more reliable.' };
        if (!parsed.txns.length) {
          failed = true;
          notes.push(file.name + ': no transactions found. ' + (parsed.hint || ''));
          continue;
        }
        const result = addTransactions(parsed.txns, file.name);
        added += result.added;
        const bits = [file.name + ': added ' + result.added];
        if (result.dupes) bits.push(result.dupes + ' duplicates skipped');
        if (parsed.skipped) bits.push(parsed.skipped + ' rows skipped');
        notes.push(bits.join(', '));
      } catch (e) {
        failed = true;
        const detail = /pdf|worker/i.test(e.message || '')
          ? 'Could not read this PDF. CSV import still works, including from a local file.'
          : (e.message || 'Could not read file');
        notes.push(file.name + ': ' + detail);
      }
    }
    if (added) save();
    setMsg(notes.join('\n') || 'Nothing to import.', added && !failed ? 'ok' : 'warn');
    refresh();
  }

  function renderStats(summary) {
    const mom = summary.mom;
    let momText = 'No prior month in this view';
    if (mom && mom.pct != null) {
      const sign = mom.delta > 0 ? '+' : '';
      momText = sign + mom.pct.toFixed(0) + '% vs ' + L.formatMonth(mom.prev.month, false);
    } else if (mom) {
      momText = fmt(mom.delta) + ' vs ' + L.formatMonth(mom.prev.month, false);
    }
    const rate = summary.savingsRate == null ? '—' : summary.savingsRate.toFixed(1) + '%';
    $('#stats').innerHTML = [
      stat('income', 'Income', fmt(summary.totalIncome), summary.incomeCount + ' deposits'),
      stat('spend', 'Spending', fmt(summary.totalSpend), momText),
      stat('net', 'Net', fmt(summary.net), rate + ' of income kept', summary.net < 0 ? 'neg' : 'pos'),
      stat('avg', 'Avg purchase', fmt(summary.avg), summary.spendCount ? summary.spendCount + ' purchases' : 'No purchases')
    ].join('');
  }

  function stat(cls, label, value, detail, valueClass) {
    return '<article class="card stat ' + cls + '"><div class="k">' + esc(label) + '</div><div class="v ' + (valueClass || '') + '">' + esc(value) + '</div><div class="detail">' + esc(detail) + '</div></article>';
  }

  function renderInsights(summary) {
    const top = summary.topCategory;
    const merchant = summary.topMerchant;
    const largest = summary.largest;
    $('#insights').innerHTML = [
      insight('Top category', top ? (MARK[top.name] || '') + ' ' + top.name : '—', top ? fmt(top.amount) : 'No spending in this view'),
      insight('Biggest merchant', merchant ? merchant.name : '—', merchant ? fmt(merchant.amount) + ' spent' : 'Spending only, not deposits'),
      insight('Savings set aside', fmt(summary.totalSavings || 0), 'Moved to savings or investments, not counted as spending'),
      insight('Largest purchase', largest ? fmt(-largest.f) : '—', largest ? largest.desc : 'No purchases in this view')
    ].join('');
  }

  function insight(label, value, detail) {
    return '<article class="card"><div class="k">' + esc(label) + '</div><div class="v">' + esc(value) + '</div><div class="detail">' + esc(detail) + '</div></article>';
  }

  function renderCategories(categories, total) {
    const host = $('#catBars');
    if (!categories.length) {
      host.innerHTML = '<p class="panel-empty">No spending in this view.</p>';
      return;
    }
    const max = categories[0][1] || 1;
    host.innerHTML = categories.map(([name, value]) => {
      const share = total ? (value / total) * 100 : 0;
      const on = S.cat === name ? ' is-on' : '';
      return '<button type="button" class="bar' + on + '" data-cat="' + esc(name) + '">' +
        '<span class="swatch" style="background:' + COL[name] + '"></span>' +
        '<span class="bar-name">' + esc((MARK[name] || '') + ' ' + name) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + Math.max(2, (value / max) * 100) + '%;background:' + COL[name] + '"></span></span>' +
        '<span class="bar-amt">' + esc(fmt(value)) + '</span>' +
        '<span class="bar-pct">' + share.toFixed(0) + '%</span></button>';
    }).join('');
  }

  function renderRecurring(list) {
    const host = $('#recur');
    if (!list.length) {
      host.innerHTML = '<li>None yet. A merchant shows up here after it appears in two different months.</li>';
      return;
    }
    host.innerHTML = list.slice(0, 8).map(item =>
      '<li><strong>' + esc(item.name) + '</strong> · ' + item.months + ' months · ' + esc(fmt(item.avg)) + ' avg</li>'
    ).join('');
  }

  function fallbackChart(months) {
    const max = Math.max(...months.map(m => Math.max(m.income, m.spend, m.savings || 0)), 1);
    return months.map(m => {
      const label = L.monthTick(m.month, true);
      return '<div class="pair"><span>' + esc(label) + '</span><div class="tracks">' +
        '<i class="in" style="width:' + (m.income / max) * 100 + '%"></i>' +
        '<i class="out" style="width:' + (m.spend / max) * 100 + '%"></i>' +
        '<i class="save" style="width:' + ((m.savings || 0) / max) * 100 + '%"></i></div></div>';
    }).join('');
  }

  function drawChart(months) {
    const seq = ++chartSeq;
    const canvas = $('#monthChart');
    const fallback = $('#chartFallback');
    if (!months.length) {
      if (chart) { chart.destroy(); chart = null; }
      canvas.hidden = true;
      fallback.hidden = false;
      fallback.textContent = 'No income or spending in the current filters.';
      return;
    }
    loadChart().then(() => {
      if (seq !== chartSeq || !S.txns.length) return;
      const withYear = new Set(months.map(m => m.month.slice(0, 4))).size > 1;
      const colors = themeColors();
      const labels = months.map(m => L.monthTick(m.month, withYear));
      const income = months.map(m => m.income);
      const spend = months.map(m => m.spend);
      const savings = months.map(m => m.savings || 0);
      canvas.hidden = false;
      fallback.hidden = true;
      if (chart && chart.data.datasets.length === 3) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = income;
        chart.data.datasets[0].backgroundColor = colors.income;
        chart.data.datasets[1].data = spend;
        chart.data.datasets[1].backgroundColor = colors.spend;
        chart.data.datasets[2].data = savings;
        chart.data.datasets[2].backgroundColor = colors.save;
        chart.options.plugins.legend.labels.color = colors.text;
        chart.options.scales.x.ticks.color = colors.text;
        chart.options.scales.y.ticks.color = colors.text;
        chart.options.scales.y.grid.color = colors.grid;
        chart.update();
        chart.resize();
        return;
      }
      if (chart) { chart.destroy(); chart = null; }
      chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Income', data: income, backgroundColor: colors.income, borderRadius: 6, maxBarThickness: 22 },
            { label: 'Spending', data: spend, backgroundColor: colors.spend, borderRadius: 6, maxBarThickness: 22 },
            { label: 'Savings', data: savings, backgroundColor: colors.save, borderRadius: 6, maxBarThickness: 22 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: colors.text, boxWidth: 12 } } },
          scales: {
            x: { ticks: { color: colors.text }, grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: { color: colors.text, callback: value => '$' + Number(value).toLocaleString('en-US') },
              grid: { color: colors.grid }
            }
          }
        }
      });
    }).catch(() => {
      if (seq !== chartSeq) return;
      if (chart) { chart.destroy(); chart = null; }
      canvas.hidden = true;
      fallback.hidden = false;
      fallback.innerHTML = fallbackChart(months);
    });
  }

  function catOptions(selected) {
    return L.categoryGroups().map(group => {
      const options = group.categories.map(c =>
        '<option value="' + esc(c.name) + '"' + (c.name === selected ? ' selected' : '') + '>' +
        esc(c.mark + ' ' + c.label) + '</option>').join('');
      return '<optgroup label="' + esc(group.name) + '">' + options + '</optgroup>';
    }).join('');
  }

  function sortRows(rows) {
    const key = S.sk;
    const dir = S.sd;
    return [...rows].sort((a, b) => {
      const x = key === 'f' ? a.f : a[key];
      const y = key === 'f' ? b.f : b[key];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  function dropMerchantOptionNodes() {
    const box = 'check' + 'box';
    document.querySelectorAll('input').forEach(node => {
      if (String(node.type || '').toLowerCase() !== box) return;
      const label = node.closest('label');
      (label || node).remove();
    });
    document.querySelectorAll('.also').forEach(node => node.remove());
  }

  function txnTable(rows) {
    const sorted = sortRows(rows);
    const headers = [['date', 'Date'], ['desc', 'Description'], ['m', 'Merchant'], ['c', 'Category'], ['f', 'Amount']];
    const head = headers.map(([key, label]) => {
      const arrow = S.sk === key ? (S.sd > 0 ? ' ▲' : ' ▼') : '';
      const sort = S.sk === key ? (S.sd > 0 ? 'ascending' : 'descending') : 'none';
      const cls = [key === 'f' ? 'num' : '', key === 'm' ? 'merchant' : ''].filter(Boolean).join(' ');
      return '<th data-sort="' + key + '" aria-sort="' + sort + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + label + arrow + '</th>';
    }).join('') + '<th aria-label="Remove"></th>';
    const body = sorted.map(t =>
      '<tr>' +
      '<td>' + esc(t.date) + '</td>' +
      '<td class="desc" title="' + esc(t.file || '') + '">' + esc(t.desc) + '</td>' +
      '<td class="merchant">' + esc(t.m) + '</td>' +
      '<td><div class="cat-cell"><span class="swatch" style="background:' + (COL[t.c] || '#475569') + '"></span>' +
        '<select data-id="' + esc(t.id) + '" aria-label="Category for this transaction">' + catOptions(t.c) + '</select></div></td>' +
      '<td class="num ' + (t.f < 0 ? 'neg' : 'pos') + '">' + esc(fmt(t.f)) + '</td>' +
      '<td><button type="button" class="icon-btn" data-del="' + esc(t.id) + '" aria-label="Remove ' + esc(t.desc) + '">Remove</button></td>' +
      '</tr>'
    ).join('');
    return '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function merchantTable(rows) {
    const map = {};
    rows.forEach(t => {
      const item = map[t.m] || (map[t.m] = { m: t.m, n: 0, net: 0, cats: {} });
      item.n += 1;
      item.net = L.round2(item.net + t.f);
      item.cats[t.c] = (item.cats[t.c] || 0) + 1;
    });
    const list = Object.values(map).map(item => ({
      ...item,
      c: Object.entries(item.cats).sort((a, b) => b[1] - a[1])[0][0]
    })).sort((a, b) => a.net - b.net);
    const body = list.map(o =>
      '<tr><td>' + esc(o.m) + '</td><td>' + esc((MARK[o.c] || '') + ' ' + o.c) + '</td>' +
      '<td class="num">' + o.n + '</td><td class="num ' + (o.net < 0 ? 'neg' : 'pos') + '">' + esc(fmt(o.net)) + '</td></tr>'
    ).join('');
    return '<div class="table-wrap"><table><thead><tr><th>Merchant</th><th>Category</th><th class="num">Count</th><th class="num">Net</th></tr></thead><tbody>' +
      body + '</tbody></table></div>';
  }

  function categoryTable(rows, summary) {
    const counts = {};
    rows.filter(L.isSpend).forEach(t => { counts[t.c] = (counts[t.c] || 0) + 1; });
    if (!summary.categories.length) return '<p class="panel-empty">No spending categories in this view.</p>';
    const body = summary.categories.map(([name, value]) => {
      const share = summary.totalSpend ? (value / summary.totalSpend) * 100 : 0;
      return '<tr><td>' + esc((MARK[name] || '') + ' ' + name) + '</td><td class="num">' + (counts[name] || 0) +
        '</td><td class="num">' + esc(fmt(value)) + '</td><td class="num">' + share.toFixed(1) + '%</td></tr>';
    }).join('');
    return '<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Count</th><th class="num">Total</th><th class="num">Share</th></tr></thead><tbody>' +
      body + '</tbody></table></div>';
  }

  function renderMonths(rows) {
    const host = $('#monthTree');
    if (!host) return;
    const yearName = String(S.selectedMonth || '').slice(0, 4);
    const years = L.monthsByYear(rows).filter(item => item.year === yearName);
    if (!years.length) {
      host.innerHTML = '<p class="panel-empty">No months in this year.</p>';
      return;
    }
    host.innerHTML = years.map(year => {
      const list = year.months.map(item => {
        const active = item.month === S.selectedMonth ? ' active' : '';
        const label = L.formatMonth(item.month, true).replace(/ \d{4}$/, '');
        return '<button type="button" class="month-row' + active + '" data-month="' + item.month + '">' +
          '<span>' + esc(label) + '</span>' +
          '<span class="neg">Spend ' + esc(fmt(item.spend)) + '</span>' +
          '<span class="pos">In ' + esc(fmt(item.income)) + '</span>' +
          '<span>Saved ' + esc(fmt(item.savings)) + '</span>' +
          '<strong>Net ' + esc(fmt(item.net)) + '</strong></button>';
      }).join('');
      return '<div class="year-block"><div class="year-head"><span>' + esc(year.year) + '</span>' +
        '<span>Spend ' + esc(fmt(year.spend)) + '</span><span>Saved ' + esc(fmt(year.savings)) +
        '</span><span>Net ' + esc(fmt(year.net)) + '</span></div><div class="month-list">' + list + '</div></div>';
    }).join('');
  }

  function projectionNote(report) {
    if (report.finished) {
      return 'Estimates from ' + report.currentLabel + ' only. That month is finished, so the month figures are the actual totals. Yearly figures repeat this month twelve times.';
    }
    if (!report.elapsed) {
      return 'Estimates from ' + report.currentLabel + ' only. That month has not started, so these are the transactions already dated in it. Yearly figures repeat them twelve times.';
    }
    return 'Estimates from ' + report.currentLabel + ' only, not actuals for other months. End-of-month pace uses day ' + report.elapsed + ' of ' + report.days + '. Yearly figures repeat that pace twelve times.';
  }

  function renderProjections(rows) {
    const report = L.projections(rows, new Date(), S.selectedMonth);
    $('#projNote').textContent = projectionNote(report);
    const shown = value => value == null ? '—' : fmt(value);
    $('#projections').innerHTML = [
      stat('spend', 'EOM spend', shown(report.projectedMonthSpend), 'Estimate. So far ' + fmt(report.spentSoFar)),
      stat('net', 'EOM savings', shown(report.projectedMonthSavings), 'Estimate. So far ' + fmt(report.savedSoFar)),
      stat('avg', 'This month spend', fmt(report.averageMonthSpend), 'Estimate for the selected month'),
      stat('income', 'This month savings', fmt(report.averageMonthSavings), 'Estimate for the selected month'),
      stat('spend', 'Year spending', fmt(report.projectedYearSpend), 'Estimate. This month × 12'),
      stat('net', 'Year savings', fmt(report.projectedYearSavings), 'Estimate. This month × 12')
    ].join('');
  }

  function renderPanel(rows, summary) {
    const panel = $('#panel');
    if (!rows.length) {
      panel.innerHTML = '<p class="panel-empty">Nothing matches these filters.</p>';
      return;
    }
    if (S.view === 'mer') panel.innerHTML = merchantTable(rows);
    else if (S.view === 'cat') panel.innerHTML = categoryTable(rows, summary);
    else panel.innerHTML = txnTable(rows);
    dropMerchantOptionNodes();
  }

  function meter(ratio, level, label) {
    const width = Math.max(0, Math.min(ratio, 1)) * 100;
    const now = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
    return '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + now + '" aria-label="' + esc(label) + '">' +
      '<span class="fill ' + level + '" style="width:' + width + '%"></span></div>';
  }

  function renderPlan(rows) {
    const bounds = periodBounds();
    const report = L.planReport(rows, S.budgets, S.goals, {
      dateFrom: bounds.from || S.dateFrom,
      dateTo: bounds.to || S.dateTo
    });
    const sig = JSON.stringify(report);
    if (sig === planSig) return;
    planSig = sig;
    const monthLine = report.monthLabel
      ? 'Compared with spending in ' + report.monthLabel + '. A category turns amber at 80% and red after it passes the limit.'
      : 'Budgets will compare against a month once there are transactions.';
    $('#budgetMonth').textContent = monthLine;
    const alerts = $('#budgetAlerts');
    alerts.innerHTML = report.alerts.map(item => {
      const text = item.level === 'over'
        ? item.name + ' is over budget by ' + fmt(Math.abs(item.left)) + '.'
        : item.name + ' is at ' + Math.round(item.ratio * 100) + '% of its ' + fmt(item.limit) + ' budget.';
      return '<p class="alert ' + item.level + '">' + esc(text) + '</p>';
    }).join('');
    const list = $('#budgetList');
    list.innerHTML = report.statuses.length ? report.statuses.map(item =>
      '<div class="plan-row"><div class="plan-head"><span>' + esc((MARK[item.name] || '') + ' ' + item.name) + '</span>' +
      '<span>' + esc(fmt(item.spent)) + ' of ' + esc(fmt(item.limit)) + '</span></div>' +
      meter(item.ratio, item.level, item.name + ' budget') +
      '<div class="plan-actions"><span class="detail">' + (item.level === 'over' ? 'Over by ' + fmt(Math.abs(item.left)) : fmt(Math.max(item.left, 0)) + ' left') + '</span>' +
      '<button type="button" class="icon-btn" data-remove-budget="' + esc(item.name) + '">Remove</button></div></div>'
    ).join('') : '<p class="detail">No budgets yet.</p>';
    const goals = $('#goalList');
    goals.innerHTML = report.goals.length ? report.goals.map(goal =>
      '<div class="plan-row"><div class="plan-head"><span>' + esc(goal.name) +
      (goal.deadline ? ' · due ' + esc(goal.deadline) : '') + (goal.done ? ' · reached' : '') + '</span>' +
      '<span>' + esc(fmt(goal.saved)) + ' of ' + esc(fmt(goal.target)) + '</span></div>' +
      meter(goal.ratio, goal.done ? 'ok' : 'near', goal.name + ' goal') +
      '<form class="contrib" data-goal="' + esc(goal.id) + '">' +
      '<label>Add <input name="amount" type="number" min="0.01" step="0.01" aria-label="Add to ' + esc(goal.name) + '"></label>' +
      '<button type="submit">Add</button>' +
      '<button type="button" class="icon-btn" data-remove-goal="' + esc(goal.id) + '">Remove</button></form></div>'
    ).join('') : '<p class="detail">No savings goals yet.</p>';
  }

  function syncTabs() {
    document.querySelectorAll('[data-view]').forEach(tab => {
      const on = tab.dataset.view === S.view;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-section]').forEach(tab => {
      const on = tab.dataset.section === S.section;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const spend = $('#sectionSpend');
    const budgets = $('#sectionBudgets');
    const goals = $('#sectionGoals');
    const projections = $('#sectionProjections');
    if (spend) spend.hidden = S.section !== 'spend';
    if (budgets) budgets.hidden = S.section !== 'budgets';
    if (goals) goals.hidden = S.section !== 'goals';
    if (projections) projections.hidden = S.section !== 'projections';
  }

  function renderPeriodBar() {
    const bar = $('#periodBar');
    const months = periodMonths();
    if (!months.length) {
      bar.hidden = false;
      $('#periodYear').innerHTML = '<option value="">—</option>';
      $('#periodMonth').innerHTML = '<option value="">—</option>';
      $('#periodHint').textContent = 'Add a transaction to choose a year and month.';
      return;
    }
    ensurePeriod();
    bar.hidden = false;
    const years = [...new Set(months.map(month => month.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
    const year = S.selectedMonth.slice(0, 4);
    const yearSel = $('#periodYear');
    const monthSel = $('#periodMonth');
    if (document.activeElement !== yearSel) {
      yearSel.innerHTML = years.map(item =>
        '<option value="' + item + '"' + (item === year ? ' selected' : '') + '>' + item + '</option>'
      ).join('');
    }
    const inYear = months.filter(month => month.startsWith(year)).sort((a, b) => b.localeCompare(a));
    if (document.activeElement !== monthSel) {
      monthSel.innerHTML = inYear.map(month => {
        const label = L.formatMonth(month, true).replace(/ \d{4}$/, '');
        return '<option value="' + month + '"' + (month === S.selectedMonth ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
    }
    $('#periodHint').textContent = 'Totals, categories, transactions, projections, budgets, and savings use ' + L.formatMonth(S.selectedMonth, true) + ' only.';
  }

  function chooseYear(year) {
    const months = periodMonths().filter(month => month.startsWith(year)).sort();
    if (!months.length) return;
    const same = year + S.selectedMonth.slice(4);
    const now = new Date();
    const current = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (months.includes(same)) S.selectedMonth = same;
    else if (months.includes(current)) S.selectedMonth = current;
    else S.selectedMonth = months[months.length - 1];
    planSig = '';
    save();
    refresh();
  }

  function refresh() {
    const empty = $('#empty');
    const dashboard = $('#dashboard');
    if (!S.txns.length) {
      const planned = Object.keys(S.budgets).length || S.goals.length;
      empty.hidden = !!planned;
      dashboard.hidden = !planned;
      $('#monthSection').hidden = true;
      if (!planned) $('#periodBar').hidden = true;
      if (planned) {
        renderPeriodBar();
        renderPlan([]);
        syncTabs();
        $('#stats').innerHTML = '';
        $('#insights').innerHTML = '';
        $('#catBars').innerHTML = '';
        $('#recur').innerHTML = '';
        $('#panel').innerHTML = '<p class="panel-empty">Add a transaction to compare these plans with real spending.</p>';
        $('#projections').innerHTML = '';
        $('#projNote').textContent = '';
        $('#resultMeta').textContent = '';
        $('#modeHint').textContent = '';
      }
      chartSeq++;
      if (chart) { chart.destroy(); chart = null; }
      dropMerchantOptionNodes();
      return;
    }
    empty.hidden = true;
    dashboard.hidden = false;
    $('#monthSection').hidden = false;
    renderPeriodBar();
    alignDatesToPeriod();
    const view = currentView();
    renderMonths(view.rows);
    const monthSummary = L.summarize(view.all);
    const summary = view.summary;
    const periodName = L.formatMonth(S.selectedMonth, true);
    $('#chartTitle').textContent = 'Income and spending in ' + periodName;
    $('#modeHint').textContent = S.mode === 'auto'
      ? 'Amount style is auto: ' + (view.mode === 'bank' ? 'bank (negative amounts are money out)' : 'card (positive charges are money out)') + '. Change it if income and spending look swapped.'
      : (view.mode === 'bank' ? 'Bank style: negative amounts are money out.' : 'Card style: positive charges are money out.');
    $('#addHint').textContent = 'Saved with the current ' + view.mode + ' amount style, so the sign matches the other rows.';
    renderStats(monthSummary);
    renderInsights(monthSummary);
    renderPlan(view.all);
    renderProjections(view.all);
    renderCategories(monthSummary.categories, monthSummary.totalSpend);
    $('#recurCard').hidden = true;
    const warn = $('#filterWarn');
    if (S.dateFrom && S.dateTo && S.dateFrom > S.dateTo) {
      warn.hidden = false;
      warn.textContent = 'The start date is after the end date, so nothing can match.';
    } else warn.hidden = true;
    const noun = view.filtered.length === 1 ? 'transaction' : 'transactions';
    $('#resultMeta').textContent = view.filtered.length + ' ' + noun + ' in ' + L.formatMonth(S.selectedMonth, true) + '.';
    syncTabs();
    drawChart(monthSummary.months);
    renderPanel(view.filtered, summary);
    dropMerchantOptionNodes();
    const cat = $('#catFilter');
    if (document.activeElement !== cat) cat.value = S.cat;
  }

  function showToast(text, onUndo) {
    $('#toastText').textContent = text;
    const btn = $('#toastAction');
    btn.hidden = !onUndo;
    btn.onclick = onUndo || null;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
  }

  function removeTxn(id) {
    const idx = S.txns.findIndex(t => t.id === id);
    if (idx < 0) return;
    const [txn] = S.txns.splice(idx, 1);
    undo = { txn, idx };
    save();
    refresh();
    showToast('Removed “' + txn.desc + '”.', () => {
      if (!undo) return;
      S.txns.splice(Math.min(undo.idx, S.txns.length), 0, undo.txn);
      undo = null;
      save();
      refresh();
      $('#toast').hidden = true;
    });
  }

  function toggleCategory(name) {
    S.cat = S.cat === name ? '' : name;
    S.view = 'tx';
    $('#catFilter').value = S.cat;
    refresh();
  }

  function readMin(value) {
    if (value === '' || value == null) return 0;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function readMax(value) {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function resetFilters() {
    S.dateFrom = '';
    S.dateTo = '';
    S.amtMin = 0;
    S.amtMax = null;
    S.cat = '';
    S.q = '';
    $('#dateFrom').value = '';
    $('#dateTo').value = '';
    $('#amtMin').value = '';
    $('#amtMax').value = '';
    $('#catFilter').value = '';
    $('#q').value = '';
    save();
    refresh();
  }

  function addSample() {
    if (S.txns.length && !confirm('Add the built-in sample next to the transactions already saved on this device?')) return;
    const result = addTransactions(L.SAMPLE_HISTORY, 'sample data');
    if (result.added) save();
    setMsg(result.added
      ? 'Added ' + result.added + ' sample transactions' + (result.dupes ? ' (' + result.dupes + ' already saved)' : '') + '.'
      : 'Sample transactions are already saved.', result.added ? 'ok' : 'warn');
    refresh();
  }

  function applyCategory(sel) {
    if (!sel) return;
    const txn = S.txns.find(t => t.id === sel.dataset.id);
    const value = L.canonicalCategory(sel.value);
    if (!txn || !value) return;
    const merchant = txn.m;
    S.rules[merchant] = value;
    let count = 0;
    S.txns.forEach(item => {
      if (item.m !== merchant) return;
      delete item.oc;
      count += 1;
    });
    setMsg('Set ' + value + ' on ' + count + ' transaction' + (count === 1 ? '' : 's') + ' from ' + merchant + '.', 'ok');
    save();
    refresh();
  }

  function bind() {
    $('#theme').addEventListener('change', e => { applyTheme(e.target.value); save(); refresh(); });
    $('#mode').addEventListener('change', e => { S.mode = e.target.value; save(); refresh(); });
    $('#exp').addEventListener('click', () => {
      const view = currentView();
      if (!view.filtered.length) {
        setMsg('Nothing to export for the current filters.', 'warn');
        return;
      }
      const blob = new Blob([L.exportCsv(view.filtered)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'spending-analysis-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#backup').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(L.buildBackup(snapshot()), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'spending-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#restoreBtn').addEventListener('click', () => $('#restoreFile').click());
    $('#restoreFile').addEventListener('change', () => {
      const file = $('#restoreFile').files[0];
      $('#restoreFile').value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = L.parseBackup(String(reader.result || ''));
          const count = Array.isArray(data.t) ? data.t.length : 0;
          if (!confirm('Replace what is saved in this browser with this backup (' + count + ' transactions)?')) return;
          applyPayload(data);
          S.q = '';
          S.cat = '';
          $('#q').value = '';
          applyTheme(S.theme);
          syncControls();
          save();
          setMsg('Restored ' + count + ' transactions from ' + file.name + '.', 'ok');
          refresh();
        } catch (e) {
          setMsg(e.message || 'Could not restore that file.', 'err');
        }
      };
      reader.onerror = () => setMsg('Could not read ' + file.name + '.', 'err');
      reader.readAsText(file);
    });
    $('#clr').addEventListener('click', () => {
      const planned = Object.keys(S.budgets).length || S.goals.length;
      if (!S.txns.length && !Object.keys(S.rules).length && !S.similar.length && !planned) {
        setMsg('There is nothing saved to clear.', 'warn');
        return;
      }
      const n = S.txns.length;
      if (!confirm('Remove all ' + n + ' saved transactions, category choices, budgets, and goals from this browser?')) return;
      S.txns = [];
      S.rules = {};
      S.similar = [];
      S.budgets = {};
      S.goals = [];
      S.q = '';
      S.cat = '';
      S.selectedMonth = '';
      $('#q').value = '';
      planSig = '';
      undo = null;
      save();
      setMsg('Removed saved transactions, budgets, and goals from this browser.', 'ok');
      refresh();
    });
    $('#budgetForm').addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(e.target);
      const name = L.canonicalCategory(data.get('category'));
      const limit = Number(data.get('limit'));
      const err = $('#planError');
      if (!name) { err.textContent = 'Choose a spending category.'; return; }
      if (!Number.isFinite(limit) || limit <= 0) { err.textContent = 'Enter a budget greater than zero.'; return; }
      S.budgets[name] = L.round2(limit);
      err.textContent = '';
      e.target.elements.limit.value = '';
      planSig = '';
      save();
      refresh();
    });
    $('#goalForm').addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(e.target);
      const name = String(data.get('name') || '').trim();
      const target = Number(data.get('target'));
      const saved = Number(data.get('saved') || 0);
      const deadline = L.parseDate(String(data.get('deadline') || ''), new Date().getFullYear()) || '';
      const err = $('#goalError');
      if (name.length < 2) { err.textContent = 'Name the goal.'; return; }
      if (!Number.isFinite(target) || target <= 0) { err.textContent = 'Enter a target greater than zero.'; return; }
      if (String(data.get('deadline') || '') && !deadline) { err.textContent = 'Use a real deadline, or leave it blank.'; return; }
      S.goals.push({ id: L.uid(), name, target: L.round2(target), saved: Number.isFinite(saved) && saved > 0 ? L.round2(saved) : 0, deadline });
      err.textContent = '';
      e.target.reset();
      planSig = '';
      save();
      refresh();
    });
    $('#dashboard').addEventListener('click', e => {
      const budget = e.target.closest('[data-remove-budget]');
      if (budget) {
        delete S.budgets[budget.dataset.removeBudget];
        planSig = '';
        save();
        refresh();
        return;
      }
      const goal = e.target.closest('[data-remove-goal]');
      if (goal) {
        S.goals = S.goals.filter(item => item.id !== goal.dataset.removeGoal);
        planSig = '';
        save();
        refresh();
      }
    });
    $('#dashboard').addEventListener('submit', e => {
      const form = e.target.closest('form.contrib');
      if (!form) return;
      e.preventDefault();
      const amount = Number(new FormData(form).get('amount'));
      const goal = S.goals.find(item => item.id === form.dataset.goal);
      if (!goal || !Number.isFinite(amount) || amount <= 0) return;
      goal.saved = L.round2(goal.saved + amount);
      planSig = '';
      save();
      refresh();
    });

    const drop = $('#drop');
    const file = $('#file');
    const openPicker = () => file.click();
    drop.addEventListener('click', e => {
      if (e.target.closest('#msg')) return;
      openPicker();
    });
    drop.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
    });
    file.addEventListener('change', () => {
      const files = [...file.files];
      file.value = '';
      if (files.length) ingest(files);
    });
    ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, e => {
      e.preventDefault();
      drop.classList.add('on');
    }));
    drop.addEventListener('dragleave', e => {
      if (e.target === drop) drop.classList.remove('on');
    });
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('on');
      ingest([...e.dataTransfer.files]);
    });

    $('#monthSection').addEventListener('click', e => {
      const month = e.target.closest('[data-month]');
      if (!month || month.dataset.month === S.selectedMonth) return;
      S.selectedMonth = month.dataset.month;
      planSig = '';
      save();
      refresh();
    });
    $('#loadSample').addEventListener('click', addSample);
    $('#loadSampleMore').addEventListener('click', addSample);
    $('#dateFrom').addEventListener('change', e => { S.dateFrom = e.target.value; save(); refresh(); });
    $('#dateTo').addEventListener('change', e => { S.dateTo = e.target.value; save(); refresh(); });
    $('#amtMin').addEventListener('change', e => { S.amtMin = readMin(e.target.value); save(); refresh(); });
    $('#amtMax').addEventListener('change', e => { S.amtMax = readMax(e.target.value); save(); refresh(); });
    $('#catFilter').addEventListener('change', e => { S.cat = e.target.value; refresh(); });
    $('#resetFilters').addEventListener('click', resetFilters);
    $('#q').addEventListener('input', e => { S.q = e.target.value; refresh(); });

    document.querySelectorAll('[data-view]').forEach(tab => {
      tab.addEventListener('click', () => {
        S.view = tab.dataset.view;
        save();
        refresh();
      });
    });
    document.querySelectorAll('[data-section]').forEach(tab => {
      tab.addEventListener('click', () => {
        S.section = tab.dataset.section;
        save();
        refresh();
      });
    });
    $('#periodYear').addEventListener('change', e => chooseYear(e.target.value));
    $('#periodMonth').addEventListener('change', e => {
      S.selectedMonth = e.target.value;
      planSig = '';
      save();
      refresh();
    });

    $('#catBars').addEventListener('click', e => {
      const bar = e.target.closest('[data-cat]');
      if (bar) toggleCategory(bar.dataset.cat);
    });
    $('#catBars').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const bar = e.target.closest('[data-cat]');
      if (!bar) return;
      e.preventDefault();
      toggleCategory(bar.dataset.cat);
    });

    $('#dashboard').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { removeTxn(del.dataset.del); return; }
      const th = e.target.closest('th[data-sort]');
      if (!th || !th.closest('#panel, #monthDetail')) return;
      const key = th.dataset.sort;
      S.sd = S.sk === key ? -S.sd : 1;
      S.sk = key;
      refresh();
    });
    $('#dashboard').addEventListener('change', e => {
      const sel = e.target.closest('select[data-id]');
      if (sel) applyCategory(sel);
    });

    $('#addForm').addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(e.target);
      const date = String(data.get('date') || '');
      const desc = String(data.get('desc') || '').trim();
      const amount = Number(data.get('amount'));
      const kind = data.get('kind') === 'income' ? 'income' : 'spend';
      const err = $('#addError');
      if (!L.parseDate(date, 2026)) { err.textContent = 'Choose a real date.'; return; }
      if (desc.length < 2) { err.textContent = 'Add a description of at least 2 characters.'; return; }
      if (!Number.isFinite(amount) || amount <= 0) { err.textContent = 'Enter an amount greater than zero.'; return; }
      const mode = L.resolveMode(S.txns, S.mode, S.rules);
      const signed = L.round2(kind === 'spend'
        ? (mode === 'card' ? amount : -amount)
        : (mode === 'card' ? -amount : amount));
      const result = addTransactions([{ date, desc, raw: signed }], 'added by hand');
      if (!result.added) { err.textContent = 'That transaction is already saved.'; return; }
      save();
      err.textContent = '';
      e.target.reset();
      const abs = Math.abs(signed);
      const hidden = (S.selectedMonth && !date.startsWith(S.selectedMonth)) ||
        (S.dateFrom && date < S.dateFrom) || (S.dateTo && date > S.dateTo) ||
        (S.amtMin && abs < S.amtMin) || (S.amtMax != null && abs > S.amtMax) ||
        (S.q && !(desc + ' ' + L.merchant(desc)).toLowerCase().includes(S.q.toLowerCase()));
      setMsg(hidden ? 'Added “' + desc + '”. It is hidden by the current filters.' : 'Added “' + desc + '”.', 'ok');
      refresh();
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (S.theme === 'auto') { applyTheme('auto'); refresh(); }
    });
  }

  function init() {
    load();
    applyTheme(S.theme);
    syncControls();
    const cat = $('#catFilter');
    cat.innerHTML = '<option value="">All categories</option>' + catOptions('');
    const budgetCat = $('#budgetCategory');
    budgetCat.innerHTML = L.categoryGroups().map(group => {
      const cats = group.categories.filter(c => c.role === 'spend');
      if (!cats.length) return '';
      return '<optgroup label="' + esc(group.name) + '">' + cats.map(c =>
        '<option value="' + esc(c.name) + '">' + esc(c.mark + ' ' + c.label) + '</option>'
      ).join('') + '</optgroup>';
    }).join('');
    bind();
    refresh();
  }

  init();
})();
