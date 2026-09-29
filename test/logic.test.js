const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const L = require('../logic.js');

const example = name => fs.readFileSync(path.join(__dirname, '../examples', name), 'utf8');

test('parses ISO, US, and month-name dates and rejects impossible days', () => {
  assert.equal(L.parseDate('2026-01-05', 2020), '2026-01-05');
  assert.equal(L.parseDate('2026/01/05', 2020), '2026-01-05');
  assert.equal(L.parseDate('01/05/2026', 2020), '2026-01-05');
  assert.equal(L.parseDate('1-5-26', 2020), '2026-01-05');
  assert.equal(L.parseDate('Jan 7, 2026', 2020), '2026-01-07');
  assert.equal(L.parseDate('7 Jan 2026', 2020), '2026-01-07');
  assert.equal(L.parseDate('Jan 7', 2026), '2026-01-07');
  assert.equal(L.parseDate('02/31/2026', 2026), null);
  assert.equal(L.parseDate('02/29/2024', 2024), '2024-02-29');
  assert.equal(L.parseDate('02/29/2025', 2025), null);
  assert.equal(L.parseDate('Date', 2026), null);
});

test('parses bank amount spellings', () => {
  assert.equal(L.parseMoney('3200.00'), 3200);
  assert.equal(L.parseMoney('-86.42'), -86.42);
  assert.equal(L.parseMoney('$1,234.56'), 1234.56);
  assert.equal(L.parseMoney('(12.50)'), -12.5);
  assert.equal(L.parseMoney('($1,234.56)'), -1234.56);
  assert.equal(L.parseMoney('12.50 CR'), 12.5);
  assert.equal(L.parseMoney('12.50DR'), -12.5);
  assert.equal(L.parseMoney('40.00-'), -40);
  assert.equal(L.parseMoney('12,50'), 12.5);
  assert.equal(L.parseMoney('1.234,56'), 1234.56);
  assert.equal(L.parseMoney(''), NaN);
  assert.equal(L.parseMoney('KROGER'), NaN);
  assert.equal(L.parseMoney('2026-01-05'), NaN);
});

test('headerless date, description, amount still imports', () => {
  const parsed = L.parseCsv('01/05/2026,PAYROLL ACME CORP,3200.00\n01/06/2026,KROGER #123,-86.42\n');
  assert.equal(parsed.txns.length, 2);
  assert.deepEqual(parsed.txns[0], { date: '2026-01-05', desc: 'PAYROLL ACME CORP', raw: 3200 });
  assert.equal(parsed.txns[1].raw, -86.42);
  assert.equal(parsed.txns[1].desc, 'KROGER #123');
});

test('simple example keeps quoted commas in the description', () => {
  const parsed = L.parseCsv('\uFEFF' + example('simple.csv'));
  assert.equal(parsed.txns.length, 5);
  const amazon = parsed.txns.find(t => t.date === '2026-01-06');
  assert.equal(amazon.desc, 'AMAZON MARKETPLACE, SEATTLE');
  assert.equal(amazon.raw, -42.18);
});

test('balance column is not treated as the transaction amount', () => {
  const parsed = L.parseCsv(example('bank-with-balance.csv'));
  assert.equal(parsed.txns.length, 6);
  const payroll = parsed.txns[0];
  assert.equal(payroll.desc, 'PAYROLL, ACME CORP');
  assert.equal(payroll.raw, 3200);
  assert.notEqual(payroll.raw, 5200);
  const coffee = parsed.txns.find(t => t.desc.includes('COFFEE'));
  assert.equal(coffee.raw, -12.5);
  const refund = parsed.txns.find(t => t.desc.startsWith('REFUND'));
  assert.equal(refund.raw, 12.5);
  const atm = parsed.txns.find(t => t.desc.startsWith('ATM'));
  assert.equal(atm.raw, -40);
});

test('headerless running balance is detected', () => {
  const csv = [
    '2026-01-05,PAYROLL ACME,3200.00,5200.00',
    '2026-01-06,KROGER,-86.42,5113.58',
    '2026-01-15,RENT PAYMENT,-1450.00,3663.58'
  ].join('\n');
  const parsed = L.parseCsv(csv);
  assert.deepEqual(parsed.txns.map(t => t.raw), [3200, -86.42, -1450]);
  assert.equal(parsed.txns[1].desc, 'KROGER');
});

test('debit and credit columns become signed amounts', () => {
  const parsed = L.parseCsv(example('debit-credit.csv'));
  assert.deepEqual(parsed.txns.map(t => [t.desc, t.raw]), [
    ['STARBUCKS', -6.25],
    ['AMAZON.COM', -54.1],
    ['PAYMENT THANK YOU', 200],
    ['SHELL GAS', -40]
  ]);
});

test('chase-like export uses transaction date, description, and amount', () => {
  const parsed = L.parseCsv(example('chase-like.csv'));
  assert.equal(parsed.txns.length, 3);
  assert.equal(parsed.txns[0].date, '2026-01-15');
  assert.equal(parsed.txns[0].desc, 'STARBUCKS STORE 1234');
  assert.equal(parsed.txns[0].raw, -5.75);
  assert.equal(parsed.txns[0].category, undefined);
  assert.equal(parsed.txns[2].desc, 'TARGET STORE');
  assert.equal(parsed.txns[2].raw, -28.19);
});

test('preamble before the header is ignored', () => {
  const csv = 'My Checking\nExported 2026-04-01\n\nDate,Description,Amount\n01/02/2026,COFFEE SHOP,-4.50\n';
  const parsed = L.parseCsv(csv);
  assert.equal(parsed.txns.length, 1);
  assert.equal(parsed.txns[0].desc, 'COFFEE SHOP');
});

test('empty and unreadable files produce no transactions and a hint', () => {
  assert.deepEqual(L.parseCsv('').txns, []);
  assert.equal(L.parseCsv('hello world\nnot a table').txns.length, 0);
  assert.match(L.parseCsv('Date,Notes\n01/01/2026,no amount').hint, /amount/i);
});

test('semicolon-separated rows import', () => {
  const parsed = L.parseCsv('Date;Description;Amount\n01/02/2026;CAFE; -4.50\n');
  assert.equal(parsed.txns.length, 1);
  assert.equal(parsed.txns[0].raw, -4.5);
  assert.equal(parsed.txns[0].desc, 'CAFE');
});

test('statement lines skip summaries, keep Total Wine, and prefer the transaction amount', () => {
  const lines = [
    'Beginning balance 1,000.00',
    '01/05/2026 PAYROLL ACME CORP 3,200.00 5,200.00',
    '01/06/2026 KROGER #123 -86.42 5,113.58',
    '01/07/2026 TOTAL WINE 40.00 4,000.00',
    'Total purchases 126.42',
    'Jan 08 NETFLIX.COM 15.49',
    '01/09/2026 AMAZON REFUND 12.50 CR',
    '7 Jan 2026 SHELL OIL 48.20'
  ];
  const txns = L.parseStatementLines(lines, 2026);
  assert.deepEqual(txns.map(t => [t.date, t.desc, t.raw]), [
    ['2026-01-05', 'PAYROLL ACME CORP', 3200],
    ['2026-01-06', 'KROGER #123', -86.42],
    ['2026-01-07', 'TOTAL WINE', 40],
    ['2026-01-08', 'NETFLIX.COM', 15.49],
    ['2026-01-09', 'AMAZON REFUND', 12.5],
    ['2026-01-07', 'SHELL OIL', 48.2]
  ]);
});

test('statement line with a posted date does not eat the description', () => {
  const txns = L.parseStatementLines(['01/15/2026 01/16/2026 STARBUCKS STORE 5.75'], 2026);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].date, '2026-01-15');
  assert.equal(txns[0].desc, 'STARBUCKS STORE');
  assert.equal(txns[0].raw, 5.75);
});

test('merchant names keep the useful words', () => {
  assert.equal(L.merchant('POS DEBIT AMAZON STORE 123'), 'Amazon Store');
  assert.equal(L.merchant('SQ *STARBUCKS'), 'Starbucks');
  assert.equal(L.merchant('CHECKCARD STARBUCKS'), 'Starbucks');
  assert.equal(L.merchant('RENT PAYMENT'), 'Rent');
  assert.equal(L.merchant('KROGER #123'), 'Kroger');
  assert.equal(L.merchant('ZELLE PAYMENT TO JORDAN'), 'Zelle Jordan');
  assert.equal(L.merchant('NETFLIX.COM'), 'Netflix');
  assert.equal(L.merchant("TRADER JOE'S"), "Trader Joe's");
});

test('categories avoid the old false positives', () => {
  assert.equal(L.autoCategory('AMAZON MARKETPLACE'), 'Shopping');
  assert.equal(L.autoCategory('WHOLE FOODS MARKET'), 'Groceries');
  assert.equal(L.autoCategory('PUBLIX SUPERMARKET'), 'Groceries');
  assert.equal(L.autoCategory('MARKETING AGENCY'), 'Other');
  assert.equal(L.autoCategory('COFFEE BEAN'), 'Dining');
  assert.equal(L.autoCategory('CITY FEE'), 'Fees');
  assert.equal(L.autoCategory('FACEBOOK ADS'), 'Other');
  assert.equal(L.autoCategory('INTEREST CHARGE'), 'Fees');
  assert.equal(L.autoCategory('INTEREST PAID'), 'Income');
  assert.equal(L.autoCategory('UBER EATS'), 'Dining');
  assert.equal(L.autoCategory('UBER TRIP'), 'Auto / Cab');
  assert.equal(L.autoCategory('PAYMENT THANK YOU'), 'Transfers');
  assert.equal(L.autoCategory('RESTORE HARDWARE'), 'Other');
  assert.equal(L.autoCategory('DELTA AIR LINES'), 'Travel');
});

test('a saved category rule overrides the guess', () => {
  const txn = { desc: 'AMAZON MARKETPLACE', m: 'Amazon' };
  assert.equal(L.categoryOf(txn, { Amazon: 'Groceries' }), 'Groceries');
  assert.equal(L.categoryOf(txn, {}), 'Shopping');
});

test('migration repairs merchant keys and keeps category overrides', () => {
  const migrated = L.migrate(
    [{ date: '2026-01-06', desc: 'KROGER #123', raw: -10, m: 'Kroger ' }],
    { 'Kroger ': 'Health' }
  );
  assert.equal(migrated.txns[0].m, 'Kroger');
  assert.equal(migrated.rules.Kroger, 'Health');
  assert.ok(migrated.txns[0].id);

  const blank = L.migrate(
    [{ date: '2026-01-01', desc: 'POS DEBIT AMAZON STORE 123', raw: -10, m: ' ' }],
    { ' ': 'Shopping' }
  );
  assert.equal(blank.txns[0].m, 'Amazon Store');
  assert.equal(blank.rules['Amazon Store'], 'Shopping');
  assert.equal(blank.rules[' '], undefined);
});

test('amount style follows purchase signs, not a single negative payment', () => {
  const bank = L.parseCsv(example('simple.csv')).txns;
  assert.equal(L.resolveMode(bank, 'auto', {}), 'bank');
  assert.equal(L.resolveMode(bank, 'card', {}), 'card');

  const card = L.parseCsv(example('card-charges.csv')).txns;
  assert.equal(L.resolveMode(card, 'auto', {}), 'card');

  const debits = L.parseCsv(example('debit-credit.csv')).txns;
  assert.equal(L.resolveMode(debits, 'auto', {}), 'bank');

  const savings = [
    { desc: 'PAYROLL ACME', raw: 3000 },
    { desc: 'PAYROLL ACME', raw: 3000 },
    { desc: 'KROGER', raw: -40 }
  ];
  assert.equal(L.resolveMode(savings, 'auto', {}), 'bank');
});

test('sample totals exclude transfers and do not call payroll the top merchant', () => {
  const { mode, rows } = L.decorate(L.SAMPLE_TXNS, 'auto', {});
  assert.equal(mode, 'bank');
  const summary = L.summarize(rows);
  assert.equal(summary.totalIncome, 9650);
  assert.equal(summary.spendCount, 28);
  assert.equal(summary.incomeCount, 4);
  assert.equal(summary.topCategory.name, 'Rent');
  assert.equal(summary.topCategory.amount, 4350);
  assert.equal(summary.topMerchant.name, 'Rent');
  assert.equal(summary.topMerchant.amount, 4350);
  assert.notEqual(summary.topMerchant.name, 'Payroll Acme');
  const zelle = rows.find(t => t.desc.startsWith('ZELLE'));
  assert.equal(zelle.c, 'Transfers');
  assert.equal(L.isSpend(zelle), false);
  assert.equal(L.isIncome(zelle), false);
  assert.equal(summary.months.length, 3);
  assert.ok(summary.months.every(m => m.spend > 0));
  const jan = summary.months[0];
  assert.equal(jan.month, '2026-01');
  assert.ok(jan.spend < 2015, 'January spend should not include the $200 transfer');
  assert.equal(summary.mom.cur.month, '2026-03');
  assert.ok(summary.recurring.some(r => r.name === 'Netflix' && r.months === 3));
  assert.ok(summary.recurring.some(r => r.name === 'Rent' && r.months === 3));
});

test('filters understand a max of zero and a search', () => {
  const { rows } = L.decorate(L.SAMPLE_TXNS, 'bank', {});
  const none = L.filterRows(rows, { amtMax: 0, amtMin: 0 });
  assert.equal(none.length, 0);
  const rent = L.filterRows(rows, { q: 'rent', cat: 'Rent' });
  assert.equal(rent.length, 3);
  const january = L.filterRows(rows, { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  assert.ok(january.every(t => t.date.startsWith('2026-01')));
  assert.ok(january.length > 0);
});

test('month labels use the local calendar month', () => {
  assert.equal(L.monthTick('2026-01', false), 'Jan');
  assert.match(L.formatMonth('2026-01', true), /January/);
  assert.match(L.formatMonth('2026-01', true), /2026/);
  const script = `
    const L = require(${JSON.stringify(path.join(__dirname, '../logic.js'))});
    const label = L.formatMonth('2026-01', true);
    if (label !== 'January 2026') {
      console.error(label);
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: 'America/Los_Angeles' }
  });
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
});

test('export round-trips displayed amounts and escapes commas', () => {
  const { rows } = L.decorate([
    { date: '2026-01-06', desc: 'AMAZON, SEATTLE', raw: -42.18, m: 'Amazon' }
  ], 'bank', {});
  const csv = L.exportCsv(rows);
  assert.match(csv.split('\n')[0], /^Date,Description,Merchant,Category,Amount$/);
  assert.match(csv, /"AMAZON, SEATTLE"/);
  const parsed = L.parseCsv(csv);
  assert.equal(parsed.txns.length, 1);
  assert.equal(parsed.txns[0].desc, 'AMAZON, SEATTLE');
  assert.equal(parsed.txns[0].raw, -42.18);
  assert.equal(parsed.txns[0].category, 'Shopping');
});

test('storage key stays spend_v3', () => {
  assert.equal(L.STORAGE_KEY, 'spend_v3');
});

test('budgets keep known spending categories and positive limits', () => {
  const budgets = L.normalizeBudgets({
    groceries: '400.126',
    Income: 1000,
    Transfers: 50,
    Housing: 0,
    Dining: -5,
    Nope: 20,
    Shopping: 150
  });
  assert.deepEqual(budgets, { Groceries: 400.13, Shopping: 150 });
});

test('goals drop blanks and keep a deadline when it is a real date', () => {
  const goals = L.normalizeGoals([
    { id: 'g1', name: '  Emergency fund  ', target: 1000, saved: 250, deadline: '2026-12-01' },
    { name: '', target: 10, saved: 0 },
    { name: 'Trip', target: 0, saved: 5 },
    { name: 'Car', target: 800, saved: -3, deadline: 'not-a-date' }
  ]);
  assert.equal(goals.length, 2);
  assert.equal(goals[0].id, 'g1');
  assert.equal(goals[0].name, 'Emergency fund');
  assert.equal(goals[0].saved, 250);
  assert.equal(goals[0].deadline, '2026-12-01');
  assert.equal(goals[1].name, 'Car');
  assert.equal(goals[1].saved, 0);
  assert.equal(goals[1].deadline, '');
  const progress = L.goalProgress(goals[0]);
  assert.equal(progress.ratio, 0.25);
  assert.equal(progress.left, 750);
  assert.equal(progress.done, false);
});

test('plan report uses the latest month unless the date filter is a single month', () => {
  const { rows } = L.decorate(L.SAMPLE_TXNS, 'bank', {});
  const latest = L.planReport(rows, { Groceries: 80, Rent: 1450, Dining: 20 }, [], {});
  assert.equal(latest.month, '2026-03');
  const groceries = latest.statuses.find(item => item.name === 'Groceries');
  assert.equal(groceries.spent, 71.55);
  assert.equal(groceries.level, 'near');
  const housing = latest.statuses.find(item => item.name === 'Rent');
  assert.equal(housing.spent, 1450);
  assert.equal(housing.level, 'ok');
  const dining = latest.statuses.find(item => item.name === 'Dining');
  assert.equal(dining.spent, 32.1);
  assert.equal(dining.level, 'over');
  assert.deepEqual(latest.alerts.map(item => item.name), ['Dining', 'Groceries']);

  const january = L.planReport(rows, { Groceries: 50 }, [], {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31'
  });
  assert.equal(january.month, '2026-01');
  assert.equal(january.statuses[0].spent, 86.42);
  assert.equal(january.statuses[0].level, 'over');

  const empty = L.planReport([], { Groceries: 50 }, [], {});
  assert.equal(empty.month, '');
  assert.equal(empty.statuses[0].spent, 0);
  assert.equal(empty.statuses[0].level, 'ok');
});

test('JSON backup round-trips and also accepts a raw spend_v3 object', () => {
  const state = {
    t: [{ date: '2026-01-05', desc: 'KROGER', raw: -10 }],
    r: { Kroger: 'Groceries' },
    m: 'bank',
    b: { Groceries: 200, Income: 999 },
    g: [{ name: 'Trip', target: 500, saved: 20 }]
  };
  const backup = L.buildBackup(state);
  assert.equal(backup.version, 1);
  assert.equal(backup.app, 'spending-analyzer');
  assert.equal(typeof backup.exportedAt, 'string');
  const restored = L.parseBackup(JSON.stringify(backup));
  assert.equal(restored.t.length, 1);
  assert.equal(restored.t[0].desc, 'KROGER');
  assert.deepEqual(restored.b, { Groceries: 200 });
  assert.equal(restored.g[0].name, 'Trip');
  assert.equal(restored.g[0].saved, 20);
  assert.equal(restored.g[0].target, 500);
  assert.ok(restored.g[0].id);

  const raw = L.parseBackup(JSON.stringify({
    t: state.t,
    r: { Kroger: 'Groceries' },
    m: 'card',
    amx: 999999,
    th: 'dark'
  }));
  assert.equal(raw.m, 'card');
  assert.equal(raw.amx, 999999);
  assert.equal(raw.th, 'dark');
  assert.deepEqual(raw.b, {});
  assert.deepEqual(raw.g, []);

  const goalsOnly = L.parseBackup(JSON.stringify({
    goals: [{ name: 'Fund', target: 10, saved: 1 }]
  }));
  assert.equal(goalsOnly.t.length, 0);
  assert.equal(goalsOnly.g[0].name, 'Fund');

  assert.throws(() => L.parseBackup('not json'), /valid JSON/);
  assert.throws(() => L.parseBackup('{"hello":1}'), /does not look like/);
});

test('a category on one transaction does not change the merchant rule', () => {
  const rules = { Netflix: 'Subscriptions' };
  const one = { desc: 'NETFLIX.COM', m: 'Netflix', oc: 'Entertainment' };
  const other = { desc: 'NETFLIX.COM', m: 'Netflix' };
  assert.equal(L.categoryOf(one, rules), 'Entertainment');
  assert.equal(L.categoryOf(other, rules), 'Subscriptions');
  assert.equal(L.canonicalCategory('Housing'), 'Housing');
  assert.equal(L.canonicalCategory('Groceries'), 'Groceries');
  const migrated = L.migrate([one, other], rules);
  assert.equal(migrated.txns[0].oc, 'Entertainment');
  assert.equal(migrated.txns[1].oc, undefined);
  assert.equal(migrated.rules.Netflix, 'Subscriptions');
});

test('savings and credit-card bills are not spending', () => {
  assert.equal(L.autoCategory('SWIGGY ORDER'), 'Food Delivery');
  assert.equal(L.autoCategory('ZOMATO'), 'Food Delivery');
  assert.equal(L.autoCategory('TRANSFER TO SAVINGS'), 'Savings');
  assert.equal(L.autoCategory('SIP GROWW MUTUAL FUND'), 'Mutual Fund / SIP');
  assert.equal(L.autoCategory('PPF CONTRIBUTION'), 'PPF');
  assert.equal(L.autoCategory('FIXED DEPOSIT'), 'Fixed Deposit');
  assert.equal(L.autoCategory('LIC OF INDIA'), 'Life Insurance');
  assert.equal(L.autoCategory('CREDIT CARD BILL'), 'Credit Card Bill');
  assert.equal(L.autoCategory('UPI/RAHUL SHARMA'), 'UPI Transfer');
  assert.equal(L.autoCategory('BESCOM ELECTRICITY'), 'Electricity');
  assert.equal(L.autoCategory('RENT PAYMENT'), 'Rent');
  assert.equal(L.autoCategory('AIRTEL MOBILE RECHARGE'), 'Mobile Recharge');
  assert.equal(L.autoCategory('BIRTHDAY GIFT'), 'Gift');
  assert.equal(L.autoCategory('SHAGUN FOR NIECE'), 'Gift');
  assert.equal(L.autoCategory('GIFT SHOP'), 'Gift');
  assert.equal(L.autoCategory('DIWALI POOJA'), 'Festivals & Pooja');
  assert.equal(L.autoCategory('AMAZON MARKETPLACE'), 'Shopping');
  assert.ok(L.categories().some(c => c.name === 'Gifts' && c.group === 'Family & religious'));
  assert.ok(L.categories().some(c => c.name === 'Gift' && c.group === 'Family & religious'));
  const { rows } = L.decorate([
    { date: '2026-09-05', desc: 'PAYROLL ACME', raw: 1000 },
    { date: '2026-09-06', desc: 'KROGER', raw: -100 },
    { date: '2026-09-07', desc: 'TRANSFER TO SAVINGS', raw: -200 },
    { date: '2026-09-08', desc: 'CREDIT CARD BILL', raw: -300 }
  ], 'bank', {});
  const summary = L.summarize(rows);
  assert.equal(summary.totalIncome, 1000);
  assert.equal(summary.totalSpend, 100);
  assert.equal(summary.totalSavings, 200);
  assert.equal(summary.net, 700);
  assert.equal(L.isSpend(rows.find(t => t.desc.startsWith('TRANSFER'))), false);
  assert.equal(L.isSavings(rows.find(t => t.desc.startsWith('TRANSFER'))), true);
  assert.equal(L.isSpend(rows.find(t => t.desc.startsWith('CREDIT'))), false);
});

test('similar payees ignore changing references and stay inside a ten dollar band', () => {
  const vinay = 'Zelle Payment To Vinay Vidyamari Jpm99Cx547X6Zelle Vinay this recharge';
  const vinayOtherCode = 'Zelle Payment To Vinay Vidyamari Qw88Lm22AaZelle Vinay';
  const vinayUpi = 'UPI/VINAY VIDYAMARI/441298';
  const vinayLeadingCode = 'Jpm99Cx547X6 Zelle Payment To Vinay Vidyamari';
  const vinayFar = 'Zelle Payment To Vinay Vidyamari Zz10Kk30BbZelle Vinay';
  const anita = 'Zelle Payment To Anita Sharma Ab12Cd34Zelle';
  assert.equal(L.payeeKey(vinay), 'vinay vidyamari');
  assert.equal(L.payeeKey(vinay), L.payeeKey(vinayOtherCode));
  assert.equal(L.payeeKey(vinay), L.payeeKey(vinayUpi));
  assert.equal(L.payeeKey(vinay), L.payeeKey(vinayLeadingCode));
  assert.equal(L.payeeKey(vinay), L.payeeKey(vinayFar));
  assert.equal(L.payeeLabel(vinay), 'Vinay Vidyamari');
  assert.notEqual(L.payeeKey(vinay), L.payeeKey(anita));
  assert.equal(L.merchant('ZELLE PAYMENT TO JORDAN'), 'Zelle Jordan');
  assert.notEqual(L.merchant(vinay), L.merchant(vinayLeadingCode));

  const rules = L.upsertSimilar([], L.payeeKey(vinay), 50, 'Mobile Recharge');
  const cat = (desc, raw) => L.categoryOf({ desc, raw, m: L.merchant(desc) }, {}, rules);
  assert.equal(cat(vinay, -50), 'Mobile Recharge');
  assert.equal(cat(vinayOtherCode, -47), 'Mobile Recharge');
  assert.equal(cat(vinayUpi, -55), 'Mobile Recharge');
  assert.equal(cat(vinayLeadingCode, -52), 'Mobile Recharge');
  assert.equal(cat(vinayOtherCode, -60), 'Mobile Recharge');
  assert.notEqual(cat(vinayOtherCode, -60.01), 'Mobile Recharge');
  assert.notEqual(cat(vinayFar, -70), 'Mobile Recharge');
  assert.equal(cat('KROGER #123', -48), 'Groceries');
  assert.notEqual(cat(anita, -50), 'Mobile Recharge');
  assert.equal(L.categoryOf({ desc: vinay, raw: -50, m: 'x', oc: 'Dining' }, {}, rules), 'Dining');
  assert.equal(L.categoryOf({ desc: vinay, raw: -50, m: 'Zelle Vinay' }, { 'Zelle Vinay': 'Transfers' }, rules), 'Transfers');
  const kept = L.normalizeSimilar(rules);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].p, 'vinay vidyamari');
  assert.equal(kept[0].a, 50);
  assert.equal(kept[0].c, 'Mobile Recharge');
});

test('months group by year and projections are labeled from pace', () => {
  const { rows } = L.decorate(L.SAMPLE_HISTORY, 'bank', {});
  const years = L.monthsByYear(rows);
  assert.deepEqual(years.map(year => year.year), ['2026', '2025']);
  assert.deepEqual(years[0].months.map(item => item.month.slice(5)), ['09', '08', '07', '06', '05', '04', '03', '02', '01']);
  assert.ok(years[1].months.some(item => item.month === '2025-10'));
  const september = years[0].months.find(item => item.month === '2026-09');
  assert.equal(september.savings, 400);
  assert.ok(september.spend > 0);
  assert.equal(september.net, L.round2(september.income - september.spend - september.savings));
  const report = L.projections(rows, new Date(2026, 8, 29));
  assert.equal(report.estimate, true);
  assert.equal(report.currentMonth, '2026-09');
  assert.equal(report.elapsed, 29);
  assert.equal(report.days, 30);
  assert.equal(report.spentSoFar, september.spend);
  assert.equal(report.projectedMonthSpend, L.round2(september.spend / 29 * 30));
  assert.equal(report.projectedMonthSavings, L.round2(400 / 29 * 30));
  assert.deepEqual(report.basedOn, ['2026-06', '2026-07', '2026-08']);
  assert.equal(report.projectedYearSpend, L.round2(report.averageMonthSpend * 12));
  assert.ok(report.averageMonthSavings > 0);
  assert.equal(L.defaultPeriod(['2026-01', '2026-09', '2025-12'], new Date(2026, 8, 29)), '2026-09');
  assert.equal(L.defaultPeriod(['2025-10', '2026-03'], new Date(2026, 8, 29)), '2026-03');
  const march = L.projections(rows, new Date(2026, 8, 29), '2026-03');
  assert.equal(march.scoped, true);
  assert.equal(march.finished, true);
  assert.equal(march.currentMonth, '2026-03');
  assert.equal(march.basedOn.length, 1);
  assert.notEqual(march.spentSoFar, september.spend);
  assert.equal(march.projectedYearSpend, L.round2(march.spentSoFar * 12));
});
