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

  const renamed = L.migrate(
    [{ id: 'rent-old', date: '2026-09-15', desc: 'RENT PAYMENT', raw: -1450, m: 'Rent Payment' }],
    { 'Rent Payment': 'Education', Rent: 'Housing' }
  );
  assert.equal(renamed.txns[0].m, 'Rent');
  assert.equal(renamed.txns[0].oc, 'Education');
  assert.equal(renamed.rules['Rent Payment'], 'Education');
  assert.equal(L.categoryOf(renamed.txns[0], renamed.rules), 'Education');
  const again = L.migrate(renamed.txns, renamed.rules);
  assert.equal(again.txns[0].oc, 'Education');
  assert.equal(L.categoryOf(again.txns[0], again.rules), 'Education');
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
  assert.equal(L.autoCategory('DIWALI POOJA'), 'Pooja');
  assert.equal(L.autoCategory('NAVRATRI'), 'Festivals & Pooja');
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

test('lend and borrow are not spending or income', () => {
  assert.equal(L.autoCategory('ZELLE PAYMENT TO JORDAN'), 'Transfers');
  assert.equal(L.autoCategory('UPI/RAHUL SHARMA'), 'UPI Transfer');
  assert.equal(L.autoCategory('ZELLE PAYMENT TO VINAY VIDYAMARI'), 'Transfers');
  assert.equal(L.autoCategory('ZELLE LEND TO VINAY'), 'Lend');
  assert.equal(L.autoCategory('LENT 200 TO ANITA'), 'Lend');
  assert.equal(L.autoCategory('UPI LENDING TO RAHUL'), 'Lend');
  assert.equal(L.autoCategory('BORROWED FROM MOM'), 'Borrow');
  assert.equal(L.autoCategory('ZELLE BORROW REPAID BY VINAY'), 'Borrow');
  assert.equal(L.autoCategory('UPI/RAHUL SHARMA BORROW'), 'Borrow');
  const lend = L.categories().find(c => c.name === 'Lend');
  const borrow = L.categories().find(c => c.name === 'Borrow');
  assert.equal(lend.group, 'Lend & borrow');
  assert.equal(borrow.group, lend.group);
  assert.equal(lend.role, 'transfer');
  assert.equal(borrow.role, 'transfer');
  const groups = L.categoryGroups().map(group => group.name);
  assert.ok(groups.indexOf('Lend & borrow') === groups.indexOf('Transfers') - 1);
  const { rows } = L.decorate([
    { date: '2026-09-05', desc: 'PAYROLL ACME', raw: 1000 },
    { date: '2026-09-06', desc: 'KROGER', raw: -100 },
    { date: '2026-09-07', desc: 'ZELLE LEND TO VINAY', raw: -80 },
    { date: '2026-09-08', desc: 'ZELLE BORROW REPAID BY VINAY', raw: 80 },
    { date: '2026-09-09', desc: 'ZELLE PAYMENT TO JORDAN', raw: -40 }
  ], 'bank', {});
  const summary = L.summarize(rows);
  assert.equal(summary.totalIncome, 1000);
  assert.equal(summary.totalSpend, 100);
  assert.equal(L.isSpend(rows.find(t => t.desc.includes('LEND'))), false);
  assert.equal(L.isIncome(rows.find(t => t.desc.includes('BORROW'))), false);
  assert.equal(rows.find(t => t.desc.includes('LEND')).c, 'Lend');
  assert.equal(rows.find(t => t.desc.includes('BORROW')).c, 'Borrow');
  assert.equal(rows.find(t => t.desc.includes('JORDAN')).c, 'Transfers');
});

test('parking stays under transport and does not take other tolls', () => {
  assert.equal(L.autoCategory('CITY PARKING'), 'Parking');
  assert.equal(L.autoCategory('CAR PARKING FEE'), 'Parking');
  assert.equal(L.autoCategory('DOWNTOWN PARKING GARAGE'), 'Parking');
  assert.equal(L.autoCategory('NH TOLL PLAZA'), 'Parking');
  assert.equal(L.autoCategory('TOLLPLAZA 12'), 'Parking');
  assert.equal(L.autoCategory('PEACH PASS'), 'Transport');
  assert.equal(L.autoCategory('TOLL'), 'Transport');
  assert.equal(L.autoCategory('UBER TRIP'), 'Auto / Cab');
  assert.equal(L.autoCategory('SHELL OIL'), 'Fuel');
  const parking = L.categories().find(c => c.name === 'Parking');
  assert.equal(parking.group, 'Transport');
  assert.equal(parking.role, 'spend');
  const names = L.categoryGroups().find(group => group.name === 'Transport').categories.map(c => c.name);
  assert.ok(names.includes('Parking'));
  assert.ok(names.indexOf('Parking') < names.indexOf('Transport'));
  const { rows } = L.decorate([
    { date: '2026-09-06', desc: 'CITY PARKING', raw: -12 },
    { date: '2026-09-06', desc: 'KROGER', raw: -20 }
  ], 'bank', {});
  const summary = L.summarize(rows);
  assert.equal(rows.find(t => t.desc === 'CITY PARKING').c, 'Parking');
  assert.equal(L.isSpend(rows.find(t => t.desc === 'CITY PARKING')), true);
  assert.equal(summary.totalSpend, 32);
});

test('pooja, devotional, and festival are separate categories', () => {
  assert.equal(L.autoCategory('POOJA SAMAGRI'), 'Pooja');
  assert.equal(L.autoCategory('PUJA'), 'Pooja');
  assert.equal(L.autoCategory('TEMPLE VISIT'), 'Pooja');
  assert.equal(L.autoCategory('PRASADAM'), 'Pooja');
  assert.equal(L.autoCategory('DEVOTIONAL SONGS'), 'Devotional');
  assert.equal(L.autoCategory('BHAJAN'), 'Devotional');
  assert.equal(L.autoCategory('AARTI'), 'Devotional');
  assert.equal(L.autoCategory('DONATION TO TEMPLE'), 'Devotional');
  assert.equal(L.autoCategory('DIWALI'), 'Festival');
  assert.equal(L.autoCategory('SANKRANTI'), 'Festival');
  assert.equal(L.autoCategory('DUSSEHRA'), 'Festival');
  assert.equal(L.autoCategory('UGADI'), 'Festival');
  assert.equal(L.autoCategory('FESTIVAL SHOPPING'), 'Festival');
  assert.equal(L.autoCategory('FUNCTION HALL'), 'Festival');
  assert.equal(L.autoCategory('DONATION'), 'Temple / Donations');
  assert.equal(L.autoCategory('WEDDING'), 'Wedding & Functions');
  assert.equal(L.autoCategory('NAVRATRI'), 'Festivals & Pooja');
  const names = L.categoryGroups().find(group => group.name === 'Family & religious').categories.map(c => c.name);
  assert.deepEqual(names.filter(name => ['Pooja', 'Devotional', 'Festival'].includes(name)), ['Devotional', 'Pooja', 'Festival']);
  for (const name of ['Pooja', 'Devotional', 'Festival']) {
    const cat = L.categories().find(c => c.name === name);
    assert.equal(cat.group, 'Family & religious');
    assert.equal(cat.role, 'spend');
  }
  const { rows } = L.decorate([
    { date: '2026-09-06', desc: 'POOJA SAMAGRI', raw: -20 },
    { date: '2026-09-06', desc: 'DONATION TO TEMPLE', raw: -30 },
    { date: '2026-09-06', desc: 'DIWALI', raw: -40 }
  ], 'bank', {});
  assert.deepEqual(rows.map(t => t.c), ['Pooja', 'Devotional', 'Festival']);
  assert.equal(L.summarize(rows).totalSpend, 90);
});

test('subscriptions is a selectable category for streaming, cloud, and gym', () => {
  assert.equal(L.autoCategory('NETFLIX.COM'), 'Subscriptions');
  assert.equal(L.autoCategory('SPOTIFY USA'), 'Subscriptions');
  assert.equal(L.autoCategory('AMAZON PRIME'), 'Subscriptions');
  assert.equal(L.autoCategory('DISNEY HOTSTAR'), 'Subscriptions');
  assert.equal(L.autoCategory('YOUTUBE PREMIUM'), 'Subscriptions');
  assert.equal(L.autoCategory('ICLOUD'), 'Subscriptions');
  assert.equal(L.autoCategory('GOOGLE ONE'), 'Subscriptions');
  assert.equal(L.autoCategory('GYM MEMBERSHIP'), 'Subscriptions');
  assert.equal(L.autoCategory('AMAZON MARKETPLACE'), 'Shopping');
  const cat = L.categories().find(c => c.name === 'Subscriptions');
  assert.equal(cat.label, 'Subscriptions');
  assert.equal(cat.group, 'Lifestyle');
  assert.equal(cat.role, 'spend');
  const names = L.categoryGroups().find(group => group.name === 'Lifestyle').categories.map(c => c.name);
  assert.ok(names.includes('Subscriptions'));
  const { rows } = L.decorate([
    { date: '2026-09-06', desc: 'AMAZON PRIME', raw: -14.99 },
    { date: '2026-09-06', desc: 'GYM MEMBERSHIP', raw: -30 },
    { date: '2026-09-06', desc: 'AMAZON MARKETPLACE', raw: -20 }
  ], 'bank', {});
  assert.equal(rows.find(t => t.desc === 'AMAZON PRIME').c, 'Subscriptions');
  assert.equal(rows.find(t => t.desc === 'GYM MEMBERSHIP').c, 'Subscriptions');
  assert.equal(rows.find(t => t.desc === 'AMAZON MARKETPLACE').c, 'Shopping');
  assert.equal(L.isSpend(rows[0]), true);
  assert.equal(L.summarize(rows).totalSpend, 64.99);
});

test('haircut and body care are separate spending categories', () => {
  assert.equal(L.autoCategory('HAIRCUT'), 'Haircut');
  assert.equal(L.autoCategory('HAIR CARE PRODUCTS'), 'Haircut');
  assert.equal(L.autoCategory('SALON VISIT'), 'Haircut');
  assert.equal(L.autoCategory('BARBER SHOP'), 'Haircut');
  assert.equal(L.autoCategory('BODY CARE'), 'Body care');
  assert.equal(L.autoCategory('SPA DAY'), 'Body care');
  assert.equal(L.autoCategory('GROOMING'), 'Body care');
  const hair = L.categories().find(c => c.name === 'Haircut');
  const body = L.categories().find(c => c.name === 'Body care');
  assert.equal(hair.group, 'Lifestyle');
  assert.equal(body.group, 'Lifestyle');
  assert.equal(hair.role, 'spend');
  assert.equal(body.role, 'spend');
  const names = L.categoryGroups().find(group => group.name === 'Lifestyle').categories.map(c => c.name);
  assert.ok(names.indexOf('Haircut') < names.indexOf('Shopping'));
  assert.ok(names.indexOf('Body care') < names.indexOf('Shopping'));
  const { rows } = L.decorate([
    { date: '2026-09-02', desc: 'BARBER SHOP', raw: -25 },
    { date: '2026-09-03', desc: 'SPA DAY', raw: 40 }
  ], 'bank', {});
  assert.equal(rows[0].c, 'Haircut');
  assert.equal(rows[1].c, 'Body care');
  assert.equal(L.isSpend(rows[0]), true);
  assert.equal(L.isIncome(rows[0]), false);
  assert.equal(L.isSpend(rows[1]), true);
  assert.equal(L.summarize(rows).totalSpend, 65);
});

test('car lease, car emi, general emi, and car charging are separate', () => {
  assert.equal(L.autoCategory('CAR LEASE PAYMENT'), 'Car Lease');
  assert.equal(L.autoCategory('VEHICLE LEASE'), 'Car Lease');
  assert.equal(L.autoCategory('AUTO LEASE'), 'Car Lease');
  assert.equal(L.autoCategory('APARTMENT LEASE'), 'Housing');
  assert.equal(L.autoCategory('CAR EMI'), 'Car EMI');
  assert.equal(L.autoCategory('CAR EMI PAYMENT'), 'Car EMI');
  assert.equal(L.autoCategory('VEHICLE EMI'), 'Vehicle EMI');
  assert.equal(L.autoCategory('HOME EMI'), 'Home Loan EMI');
  assert.equal(L.autoCategory('PERSONAL LOAN EMI'), 'Personal Loan EMI');
  assert.equal(L.autoCategory('EMI XYZ'), 'EMI');
  assert.equal(L.autoCategory('ELECTRIC CAR CHARGE'), 'Car charge');
  assert.equal(L.autoCategory('CAR CHARGE'), 'Car charge');
  assert.equal(L.autoCategory('EV CHARGING'), 'Car charge');
  assert.equal(L.autoCategory('CHARGING STATION'), 'Car charge');
  assert.equal(L.autoCategory('GEORGIA POWER ELECTRIC'), 'Electricity');
  const lease = L.categories().find(c => c.name === 'Car Lease');
  const charge = L.categories().find(c => c.name === 'Car charge');
  const carEmi = L.categories().find(c => c.name === 'Car EMI');
  const emi = L.categories().find(c => c.name === 'EMI');
  assert.equal(lease.group, 'Transport');
  assert.equal(charge.group, 'Transport');
  assert.equal(charge.label, 'Electric car charge');
  assert.equal(carEmi.group, 'Loans & tax');
  assert.equal(emi.group, 'Loans & tax');
  for (const cat of [lease, charge, carEmi, emi]) assert.equal(cat.role, 'spend');
  const transport = L.categoryGroups().find(group => group.name === 'Transport').categories.map(c => c.name);
  const loans = L.categoryGroups().find(group => group.name === 'Loans & tax').categories.map(c => c.name);
  assert.ok(transport.includes('Car Lease') && transport.includes('Car charge'));
  assert.ok(loans.indexOf('Car EMI') < loans.indexOf('Vehicle EMI'));
  assert.ok(loans.indexOf('Vehicle EMI') < loans.indexOf('EMI'));
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

test('category decides income and spending, not the amount sign', () => {
  const { rows } = L.decorate([
    { date: '2026-09-05', desc: 'PAYROLL ACME', raw: -3300 },
    { date: '2026-09-15', desc: 'RENT PAYMENT', raw: 1450 },
    { date: '2026-09-16', desc: 'KROGER', raw: 40 },
    { date: '2026-09-17', desc: 'EMI XYZ', raw: 250 },
    { date: '2026-09-07', desc: 'TRANSFER TO SAVINGS', raw: 200 },
    { date: '2026-09-08', desc: 'ZELLE LEND TO VINAY', raw: 80 },
    { date: '2026-09-09', desc: 'BORROWED FROM MOM', raw: -50 }
  ], 'bank', {});
  const payroll = rows.find(t => t.desc.startsWith('PAYROLL'));
  const rent = rows.find(t => t.c === 'Rent');
  const groceries = rows.find(t => t.c === 'Groceries');
  const emi = rows.find(t => t.c === 'EMI');
  const savings = rows.find(t => t.desc.includes('SAVINGS'));
  const lend = rows.find(t => t.desc.includes('LEND'));
  const borrow = rows.find(t => t.desc.includes('BORROW'));
  assert.equal(L.isIncome(payroll), true);
  assert.equal(L.isSpend(payroll), false);
  assert.equal(L.isSpend(rent), true);
  assert.equal(L.isIncome(rent), false);
  assert.equal(L.isSpend(groceries), true);
  assert.equal(L.isSpend(emi), true);
  assert.equal(L.isIncome(emi), false);
  assert.equal(L.isSavings(savings), true);
  assert.equal(L.isSpend(savings), false);
  assert.equal(L.isIncome(savings), false);
  assert.equal(L.isSpend(lend), false);
  assert.equal(L.isIncome(lend), false);
  assert.equal(L.isSpend(borrow), false);
  assert.equal(L.isIncome(borrow), false);
  const summary = L.summarize(rows);
  assert.equal(summary.totalIncome, 3300);
  assert.equal(summary.totalSpend, 1740);
  assert.equal(summary.totalSavings, 200);
  assert.equal(summary.topCategory.name, 'Rent');
  assert.equal(summary.topCategory.amount, 1450);
  assert.equal(summary.months[0].income, 3300);
  assert.equal(summary.months[0].spend, 1740);
  assert.equal(summary.months[0].savings, 200);
});

test('category totals list every non-zero spending category', () => {
  const { rows } = L.decorate([
    { date: '2026-09-01', desc: 'RENT PAYMENT', raw: 10 },
    { date: '2026-09-02', desc: 'KROGER', raw: -0.01 },
    { date: '2026-09-03', desc: 'STARBUCKS', raw: 4 },
    { date: '2026-09-04', desc: 'SHELL OIL', raw: 5 },
    { date: '2026-09-05', desc: 'BESCOM ELECTRICITY', raw: 6 },
    { date: '2026-09-06', desc: 'NETFLIX.COM', raw: 7 },
    { date: '2026-09-07', desc: 'AMAZON MARKETPLACE', raw: 8 },
    { date: '2026-09-08', desc: 'DELTA AIRLINES', raw: 9 },
    { date: '2026-09-09', desc: 'BIRTHDAY GIFT', raw: 11 },
    { date: '2026-09-10', desc: 'SCHOOL FEE', raw: 12 },
    { date: '2026-09-11', desc: 'CVS PHARMACY', raw: 13 },
    { date: '2026-09-12', desc: 'CITY PARKING', raw: 14 },
    { date: '2026-09-13', desc: 'CAR LEASE PAYMENT', raw: 15 },
    { date: '2026-09-14', desc: 'EMI XYZ', raw: 16 },
    { date: '2026-09-15', desc: 'COMCAST INTERNET', raw: 17 },
    { date: '2026-09-16', desc: 'PAYROLL ACME', raw: 3000 },
    { date: '2026-09-17', desc: 'TRANSFER TO SAVINGS', raw: -200 },
    { date: '2026-09-18', desc: 'ZELLE LEND TO VINAY', raw: -40 },
    { date: '2026-09-19', desc: 'ZERO FEE', raw: 0 }
  ], 'bank', {});
  const names = L.summarize(rows).categories.map(([name]) => name);
  assert.deepEqual(names, [
    'Internet', 'EMI', 'Car Lease', 'Parking', 'Medical / Pharmacy', 'School Fees',
    'Gift', 'Rent', 'Travel', 'Shopping', 'Subscriptions', 'Electricity', 'Fuel', 'Dining', 'Groceries'
  ]);
  assert.equal(names.includes('Income'), false);
  assert.equal(names.includes('Savings'), false);
  assert.equal(names.includes('Lend'), false);
  assert.equal(names.includes('Fees'), false);
});

test('custom categories keep their name, icon, and transactions', () => {
  L.setCustomCategories([]);
  try {
    assert.ok(L.customIcons().length >= 12);
    assert.ok(L.customIcons().includes('🐶'));
    const added = L.addCustomCategory([], 'Pet care', '🐶');
    assert.equal(added.ok, true);
    assert.equal(L.addCustomCategory(added.categories, 'Rent', '🏠').ok, false);
    assert.equal(L.addCustomCategory(added.categories, 'P', '🐶').ok, false);
    assert.equal(L.addCustomCategory(added.categories, 'Pet care', '🐶').ok, false);
    assert.equal(L.addCustomCategory(added.categories, 'Vet', 'nope').ok, false);
    L.setCustomCategories(added.categories);
    assert.equal(L.canonicalCategory('pet care'), 'Pet care');
    assert.equal(L.categoryRole('Pet care'), 'spend');
    const pet = L.categories().find(c => c.name === 'Pet care');
    assert.equal(pet.mark, '🐶');
    assert.equal(pet.group, 'Your categories');
    assert.equal(pet.role, 'spend');
    const groups = L.categoryGroups().map(group => group.name);
    assert.ok(groups.indexOf('Your categories') === groups.indexOf('Other') - 1);

    const txns = [{ id: '1', date: '2018-03-04', desc: 'VET CLINIC', raw: -40, m: 'Vet Clinic', oc: 'Pet care' }];
    const rules = { 'Vet Clinic': 'Pet care' };
    const similar = [{ p: 'vet clinic', a: 40, c: 'Pet care' }];
    const budgets = { 'Pet care': 80, Groceries: 100 };
    const migrated = L.migrate(txns, rules);
    assert.equal(migrated.txns[0].oc, 'Pet care');
    assert.equal(migrated.txns.length, 1);
    assert.equal(migrated.rules['Vet Clinic'], 'Pet care');

    const renamed = L.updateCustomCategory(added.categories, 'Pet care', 'Pets', '🐾');
    assert.equal(renamed.ok, true);
    L.setCustomCategories(renamed.categories);
    const moved = L.reassignCategory(migrated.txns, migrated.rules, similar, budgets, renamed.from, renamed.to, false);
    assert.equal(moved.txns[0].oc, 'Pets');
    assert.equal(moved.txns[0].desc, 'VET CLINIC');
    assert.equal(moved.rules['Vet Clinic'], 'Pets');
    assert.equal(moved.similar[0].c, 'Pets');
    assert.equal(moved.budgets.Pets, 80);
    assert.equal(moved.budgets.Groceries, 100);
    const again = L.migrate(moved.txns, moved.rules);
    assert.equal(again.txns[0].oc, 'Pets');
    assert.equal(L.categoryOf(again.txns[0], again.rules), 'Pets');

    const removed = L.removeCustomCategory(renamed.categories, 'Pets');
    assert.equal(removed.to, 'Other');
    const cleared = L.reassignCategory(again.txns, again.rules, moved.similar, moved.budgets, removed.from, removed.to, true);
    assert.equal(cleared.txns.length, 1);
    assert.equal(cleared.txns[0].oc, 'Other');
    assert.equal(cleared.rules['Vet Clinic'], 'Other');
    assert.equal(cleared.budgets.Pets, undefined);
    assert.equal(cleared.budgets.Groceries, 100);

    L.setCustomCategories([]);
    const stripped = L.migrate(
      [{ oc: 'Pets', desc: 'VET CLINIC', m: 'Vet Clinic', date: '2018-03-04', raw: -1 }],
      { 'Vet Clinic': 'Pets' }
    );
    assert.equal(stripped.txns[0].oc, undefined);
    assert.equal(stripped.rules['Vet Clinic'], undefined);
    assert.equal(stripped.txns[0].desc, 'VET CLINIC');

    const backup = L.buildBackup({
      t: [{ date: '2018-03-04', desc: 'VET CLINIC', raw: -40, oc: 'Pets' }],
      cc: renamed.categories,
      b: { Pets: 25, Groceries: 10 },
      sr: [{ p: 'vet clinic', a: 40, c: 'Pets' }]
    });
    const restored = L.parseBackup(JSON.stringify(backup));
    assert.deepEqual(restored.cc, [{ name: 'Pets', icon: '🐾' }]);
    assert.equal(restored.b.Pets, 25);
    assert.equal(restored.b.Groceries, 10);
    assert.equal(restored.sr[0].c, 'Pets');
    assert.equal(L.getCustomCategories().length, 0);
  } finally {
    L.setCustomCategories([]);
  }
});

test('a typed year and an empty month stay available', () => {
  assert.equal(L.validPeriod('2018-03'), '2018-03');
  assert.equal(L.validPeriod('1970-01'), '1970-01');
  assert.equal(L.validPeriod('2100-12'), '2100-12');
  assert.equal(L.validPeriod('1969-12'), '');
  assert.equal(L.validPeriod('2101-01'), '');
  assert.equal(L.validPeriod('2018-13'), '');
  assert.equal(L.validPeriod(''), '');
  L.setCustomCategories([{ name: 'Pet care', icon: '🐶' }]);
  try {
    assert.equal(L.entrySign(12.5, 'Pet care', 'bank'), -12.5);
    assert.equal(L.entrySign(12.5, 'Pet care', 'card'), 12.5);
    assert.equal(L.entrySign(12.5, 'Income', 'bank'), 12.5);
    assert.equal(L.entrySign(12.5, 'Income', 'card'), -12.5);
    assert.equal(L.entrySign(12.5, 'Borrow', 'bank'), 12.5);
    assert.equal(L.entrySign(12.5, 'Savings', 'bank'), -12.5);
    const view = L.decorate([
      { date: '2018-03-04', desc: 'VET CLINIC', raw: -12.5, m: 'Vet Clinic', oc: 'Pet care' }
    ], 'bank', { 'Vet Clinic': 'Pet care' });
    assert.equal(view.rows[0].c, 'Pet care');
    const summary = L.summarize(view.rows);
    assert.equal(summary.totalSpend, 12.5);
    assert.equal(summary.totalIncome, 0);
    assert.equal(summary.categories[0][0], 'Pet care');
    assert.equal(summary.categories[0][1], 12.5);
  } finally {
    L.setCustomCategories([]);
  }
});
