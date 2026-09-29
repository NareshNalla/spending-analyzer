/* Pure spending-analyzer logic. No DOM. Loaded as a classic script in the browser
   and as a CommonJS module from node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpendLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // localStorage key spend_v3. Existing fields stay: t, r, m, f, to, amn, amx, th, sm.
  // Optional: v (tab), b (budgets), g (goals), and oc on a transaction (that row's category only).
  const STORAGE_KEY = 'spend_v3';
  const BACKUP_VERSION = 1;

  // name, color, regex, mark, group, role, optional label.
  // Role spend counts as an expense. Savings is money set aside. Transfer is neither.
  // First matching regex wins, so specific merchants stay above broad ones.
  // Older names (Housing, Groceries, Transport, Utilities, Health, ...) stay valid.
  const CATS = [
    ['Income', '#16a34a', /payroll|direct deposit|direct dep|salary|paycheck|\bbonus\b|dividend|\brefund\b|reversal|interest paid|\bstipend\b/i, '💰', 'Income', 'income'],
    ['Mutual Fund / SIP', '#0369a1', /\bsip\b|mutual fund|groww|zerodha|kuvera|paytm money|mf purchase/i, '📈', 'Savings & investments', 'savings'],
    ['PPF', '#0369a1', /\bppf\b|\bepf\b|\bnps\b|public provident|provident fund/i, '📈', 'Savings & investments', 'savings'],
    ['Fixed Deposit', '#0369a1', /fixed deposit|\bfd\b/i, '📈', 'Savings & investments', 'savings'],
    ['Recurring Deposit', '#0369a1', /recurring deposit/i, '📈', 'Savings & investments', 'savings'],
    ['Savings', '#0f766e', /transfer to savings|savings account|savings transfer/i, '🏦', 'Savings & investments', 'savings'],
    ['Gold & Jewellery', '#a16207', /tanishq|malabar gold|kalyan jewell|joyalukkas|\bgold\b|jewellery|jewelry/i, '◆', 'Savings & investments', 'savings'],
    ['Food Delivery', '#ea580c', /swiggy|zomato|eatsure/i, '🛵', 'Food', 'spend', 'Food Delivery (Swiggy/Zomato)'],
    ['Milk / Dairy', '#15803d', /\bmilk\b|amul|mother dairy|heritage foods/i, '🥛', 'Food', 'spend'],
    ['Vegetables', '#15803d', /vegetable|\bsabzi\b|\bveggies?\b/i, '🥬', 'Food', 'spend'],
    ['Groceries', '#15803d', /kroger|publix|walmart|aldi|whole foods|trader joe|costco|safeway|grocery|kirana|patel|\bh mart\b|sprouts|instacart|supermarket|\bmarkets?\b|dmart|d-mart|bigbasket|jiomart|reliance fresh|blinkit|zepto|instamart/i, '🛒', 'Food', 'spend', 'Groceries / Kirana'],
    ['Dining', '#c2410c', /restaurant|\bcafe\b|\bcoffee\b|starbucks|mcdonald|chipotle|pizza|doordash|uber\s?eats|ubereats|grubhub|dunkin|subway|\btaco\b|\bgrill\b|\bdiner\b|\bbbq\b|burger|bakery|biryani|wingstop|chick-fil/i, '🍴', 'Food', 'spend'],
    ['Auto / Cab', '#0284c7', /\bola\b|rapido|uber|lyft/i, '🚕', 'Transport', 'spend', 'Auto / Cab (Ola/Uber/Rapido)'],
    ['Fuel', '#0369a1', /\bshell\b|chevron|exxon|\bbp\b|petrol|diesel|hpcl|iocl|indian oil|bharat petroleum|nayara|\bfuel\b|racetrac|quiktrip|\bqt\b|citgo|\bmobil\b/i, '⛽', 'Transport', 'spend', 'Fuel / Petrol'],
    ['Metro / Bus / Train', '#0369a1', /\bmetro\b|bmrc|dmrc|\birctc\b|bus pass|local train|\bmarta\b|transit/i, '🚇', 'Transport', 'spend'],
    ['Parking', '#0369a1', /car parking|\bparking\b|\bgarage\b|toll\s?plaza/i, '🅿️', 'Transport', 'spend'],
    ['Transport', '#0284c7', /\btoll\b|peach pass/i, '🚌', 'Transport', 'spend'],
    ['Rent', '#0f766e', /\brent\b/i, '⌂', 'Housing', 'spend'],
    ['Home Loan EMI', '#0f766e', /home loan|housing loan|\bmortgage\b|home emi/i, '⌂', 'Housing', 'spend'],
    ['Property Tax', '#0f766e', /property tax/i, '⌂', 'Housing', 'spend'],
    ['Society / Maintenance', '#0f766e', /society maintenance|maintenance charge|\bhoa\b|apartment maintenance/i, '⌂', 'Housing', 'spend', 'Society / Maintenance Charges'],
    ['Home Repairs', '#0f766e', /home repair|\bplumber\b|electrician/i, '⌂', 'Housing', 'spend', 'Home Repairs & Maintenance'],
    ['Housing', '#115e59', /\blease\b|apartment|homeowner|\bproperty\b/i, '⌂', 'Housing', 'spend'],
    ['Electricity', '#a16207', /electric|georgia power|bescom|msedcl|tata power|cescom|tangedco|\bkseb\b|mseb/i, '⚡', 'Utilities', 'spend'],
    ['Water', '#0369a1', /\bwater\b|bwssb/i, '💧', 'Utilities', 'spend'],
    ['Gas / LPG', '#a16207', /indane|hp gas|bharat gas|\blpg\b|gas cylinder|\bigl\b|mahanagar gas|\bgas co\b|atmos/i, '🔥', 'Utilities', 'spend', 'Gas / LPG Cylinder'],
    ['Internet', '#7c3aed', /broadband|fibernet|hathway|jiofiber|jio fiber|comcast|xfinity|\binternet\b/i, '🌐', 'Utilities', 'spend', 'Internet / Broadband'],
    ['Mobile Recharge', '#7c3aed', /mobile recharge|\bjio\b|airtel|vodafone|bsnl|verizon|t-mobile|\brecharge\b/i, '📱', 'Utilities', 'spend'],
    ['DTH / Cable', '#7c3aed', /\bdth\b|tata play|tata sky|dishtv|dish tv|sun direct|\bcable\b/i, '📺', 'Utilities', 'spend'],
    ['Utilities', '#a16207', /\butility\b|spectrum|\bphone\b/i, '⚡', 'Utilities', 'spend'],
    ['Maid / Domestic Help', '#7c2d12', /\bmaid\b|domestic help|house ?help/i, '🧹', 'Household help', 'spend'],
    ['Cook', '#7c2d12', /\bcook\b/i, '🍳', 'Household help', 'spend'],
    ['Driver', '#7c2d12', /\bdriver\b/i, '🚗', 'Household help', 'spend'],
    ['School Fees', '#4d7c0f', /school fee/i, '📚', 'Education', 'spend', "Children's School Fees"],
    ['Tuition / Coaching', '#4d7c0f', /tuition|coaching|byju|unacademy|vedantu/i, '📚', 'Education', 'spend'],
    ['Education', '#4d7c0f', /\bschool\b|university|udemy|coursera|\bbooks?\b|\bclasses?\b|\bcourse\b|training|seminar/i, '📚', 'Education', 'spend'],
    ['Health Insurance', '#be185d', /health insurance|star health|care health|niva bupa/i, '+', 'Health & insurance', 'spend'],
    ['Life Insurance', '#be185d', /\blic\b|life insurance|term insurance/i, '+', 'Health & insurance', 'spend', 'Life Insurance / LIC'],
    ['Vehicle Insurance', '#be185d', /geico|state farm|allstate|vehicle insurance|car insurance/i, '+', 'Health & insurance', 'spend'],
    ['Medical / Pharmacy', '#be185d', /\bcvs\b|walgreens|pharmacy|apollo pharmacy|medplus|netmeds|\b1mg\b|pharmeasy|clinic|hospital|dental|\bhealth\b|doctor|vision|optum|aetna|labcorp|quest diag/i, '+', 'Health & insurance', 'spend'],
    ['Health', '#9d174d', /medical/i, '+', 'Health & insurance', 'spend'],
    ['Vehicle EMI', '#9f1239', /vehicle emi|car emi|car loan|bike loan|two wheeler/i, '🏦', 'Loans & tax', 'spend'],
    ['Personal Loan EMI', '#9f1239', /personal loan/i, '🏦', 'Loans & tax', 'spend'],
    ['Income Tax / TDS', '#9f1239', /income tax|\btds\b|advance tax/i, '🏦', 'Loans & tax', 'spend'],
    ['Fees', '#dc2626', /\bfees?\b|interest charge|overdraft|finance charge|\bpenalty\b/i, '!', 'Loans & tax', 'spend'],
    ['Festivals & Pooja', '#a21caf', /pooja|\bpuja\b|diwali|navratri|\bfestival\b/i, '✦', 'Family & religious', 'spend'],
    ['Temple / Donations', '#a21caf', /temple|donation|tirupati|gurudwara|\bchurch\b|mosque/i, '✦', 'Family & religious', 'spend'],
    ['Family Support', '#a21caf', /family support|sending money home|money home/i, '✦', 'Family & religious', 'spend', 'Family Support / Sending Money Home'],
    ['Gift', '#a21caf', /\bgifts?\b|\bpresents?\b|shagun|gift\s?card|gift\s?shop|\bhamper\b/i, '✦', 'Family & religious', 'spend'],
    ['Gifts', '#a21caf', /\bgifts?\b/i, '✦', 'Family & religious', 'spend'],
    ['Wedding & Functions', '#a21caf', /wedding|function hall|\bmarriage\b/i, '✦', 'Family & religious', 'spend'],
    ['Subscriptions', '#7c3aed', /netflix|spotify|hulu|disney|hotstar|sonyliv|zee5|apple\.|itunes|google \*|youtube|openai|anthropic|claude|prime video|adobe|microsoft|\bsubscription\b|patreon|icloud/i, '▶', 'Lifestyle', 'spend', 'Entertainment / OTT'],
    ['Entertainment', '#c026d3', /\bamc\b|cinema|movie|ticketmaster|steam|\bgames?\b|gamestop|concert|bowling|theater|\bshow\b/i, '★', 'Lifestyle', 'spend'],
    ['Shopping', '#e11d48', /amazon|\bamzn\b|flipkart|myntra|ajio|meesho|\btarget\b|best buy|ebay|etsy|home depot|\blowes?\b|\blowe's\b|ikea|\bnike\b|\bmacy\b|tj maxx|marshalls|\bshops?\b|\bstores?\b|retail/i, '🛍', 'Lifestyle', 'spend', 'Shopping (Amazon/Flipkart/Myntra)'],
    ['Travel', '#4f46e5', /airline|delta air|united air|southwest|american air|hotel|airbnb|marriott|hilton|expedia|booking\.com|\bflights?\b|motel|\btrips?\b/i, '✈', 'Lifestyle', 'spend'],
    ['Lend', '#0e7490', /\blends?\b|\blending\b|\blent\b/i, '↗', 'Lend & borrow', 'transfer', 'Lend (money given)'],
    ['Borrow', '#155e75', /\bborrow(?:s|ed|ing)?\b/i, '↙', 'Lend & borrow', 'transfer', 'Borrow (received back or taken)'],
    ['Credit Card Bill', '#64748b', /credit card bill|credit card payment|card bill|\bcc payment\b/i, '↔', 'Transfers', 'transfer'],
    ['UPI Transfer', '#64748b', /\bupi\b|phonepe|\bgpay\b|google pay/i, '↔', 'Transfers', 'transfer', 'UPI Transfers'],
    ['Transfers', '#64748b', /zelle|venmo|paypal|cash app|\btransfers?\b|\btransferred\b|autopay|payment\W{0,6}thank|online payment|\bwire\b|credit card pmt|\bepay\b/i, '↔', 'Transfers', 'transfer'],
    ['Other', '#475569', /^$/, '•', 'Other', 'spend']
  ];

  const GROUP_ORDER = [
    'Income', 'Housing', 'Utilities', 'Household help', 'Food', 'Transport',
    'Family & religious', 'Education', 'Health & insurance', 'Loans & tax',
    'Savings & investments', 'Lifestyle', 'Lend & borrow', 'Transfers', 'Other'
  ];

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DATE_RANKS = ['transaction date', 'trans date', 'txn date', 'date', 'posted date', 'posting date', 'post date', 'date posted'];
  const DESC_RANKS = ['description', 'transaction description', 'desc', 'narrative', 'details', 'payee', 'name', 'memo', 'merchant'];
  const AMOUNT_NAMES = new Set(['amount', 'amt', 'transaction amount', 'amount usd', 'amount $']);
  const DEBIT_NAMES = new Set(['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'outflow', 'paid out']);
  const CREDIT_NAMES = new Set(['credit', 'credits', 'deposit', 'deposits', 'money in', 'inflow', 'paid in']);
  const BALANCE_NAMES = new Set(['balance', 'running balance', 'running bal', 'available balance', 'ending balance', 'current balance']);
  const DATE_TOKEN = String.raw`\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?|[A-Za-z]{3}[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}[- ][A-Za-z]{3}[a-z]*(?:[- ,]+\d{2,4})?`;
  const LINE_RE = new RegExp('^(' + DATE_TOKEN + ')\\s+(.+)$');
  const SECOND_DATE_RE = /^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?)\s+(.*)$/;
  // Commas optional, so both 3,200.00 and 3200.00 match. Cents stay required so
  // years and account numbers on a statement line are less likely to match.
  const AMT_SRC = String.raw`(?<![\w.])\(?[-+]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})\)?(?:-|\s?(?:CR|DB|DR))?(?![\w])`;
  const SUMMARY_LINE = /(beginning|ending|opening|closing|previous|new|available)\s+balance|credit limit|minimum payment|account summary/i;
  const SUMMARY_DESC = /^(total|subtotal|totals|total (purchases|debits|credits|withdrawals|deposits|fees|payments|amount|charges))$/i;

  const SAMPLE_TXNS = [
    ['2026-01-05', 'PAYROLL ACME CORP', 3200],
    ['2026-01-03', 'ZELLE PAYMENT TO JORDAN', -200],
    ['2026-01-06', 'KROGER #123', -86.42],
    ['2026-01-07', 'STARBUCKS STORE 1234', -5.75],
    ['2026-01-08', 'SHELL OIL 5678', -48.2],
    ['2026-01-09', 'NETFLIX.COM', -15.49],
    ['2026-01-10', 'AMAZON MARKETPLACE', -42.18],
    ['2026-01-12', 'UBER TRIP', -18.6],
    ['2026-01-15', 'RENT PAYMENT', -1450],
    ['2026-01-18', 'GEORGIA POWER', -96.3],
    ['2026-01-20', 'CHIPOTLE 1122', -13.45],
    ['2026-01-22', 'CVS PHARMACY', -24.1],
    ['2026-01-28', 'SPOTIFY USA', -11.99],
    ['2026-01-30', 'INTEREST CHARGE', -3.2],
    ['2026-02-05', 'PAYROLL ACME CORP', 3200],
    ['2026-02-06', 'PUBLIX SUPERMARKET', -92.1],
    ['2026-02-08', 'DOORDASH MCDONALDS', -27.4],
    ['2026-02-10', 'NETFLIX.COM', -15.49],
    ['2026-02-14', 'DELTA AIR LINES', -286],
    ['2026-02-15', 'RENT PAYMENT', -1450],
    ['2026-02-20', 'WHOLE FOODS MARKET', -64.22],
    ['2026-02-25', 'AMAZON PRIME', -14.99],
    ['2026-02-27', 'GEICO INSURANCE', -142],
    ['2026-03-02', 'AMAZON REFUND', 50],
    ['2026-03-05', 'PAYROLL ACME CORP', 3200],
    ['2026-03-07', "TRADER JOE'S", -71.55],
    ['2026-03-09', 'UBER EATS', -32.1],
    ['2026-03-12', 'CHEVRON GAS', -51.8],
    ['2026-03-15', 'RENT PAYMENT', -1450],
    ['2026-03-18', 'NETFLIX.COM', -15.49],
    ['2026-03-22', 'TARGET STORE', -88.4],
    ['2026-03-25', 'AMC THEATERS', -28],
    ['2026-03-28', 'APPLE.COM/BILL', -9.99]
  ].map(([date, desc, raw]) => ({ date, desc, raw }));

  const SAMPLE_HISTORY = SAMPLE_TXNS.concat([
    ['2025-10-03', 'PAYROLL ACME CORP', 3100],
    ['2025-10-04', 'RENT PAYMENT', -1450],
    ['2025-10-06', 'KIRANA STORE', -74.2],
    ['2025-10-08', 'BESCOM ELECTRICITY', -68],
    ['2025-10-11', 'SWIGGY ORDER', -32.5],
    ['2025-10-14', 'SIP GROWW MUTUAL FUND', -500],
    ['2025-10-18', 'UPI/RAHUL SHARMA', -150],
    ['2025-10-21', 'HP GAS LPG', -95],
    ['2025-11-03', 'PAYROLL ACME CORP', 3100],
    ['2025-11-04', 'RENT PAYMENT', -1450],
    ['2025-11-07', 'BIGBASKET', -88.4],
    ['2025-11-09', 'AIRTEL MOBILE RECHARGE', -29],
    ['2025-11-12', 'OLA CAB', -22.6],
    ['2025-11-16', 'TRANSFER TO SAVINGS', -400],
    ['2025-11-20', 'APOLLO PHARMACY', -18.75],
    ['2025-12-03', 'PAYROLL ACME CORP', 3100],
    ['2025-12-04', 'RENT PAYMENT', -1450],
    ['2025-12-08', 'DMART GROCERY', -102.3],
    ['2025-12-11', 'LIC OF INDIA', -240],
    ['2025-12-15', 'CREDIT CARD BILL', -900],
    ['2025-12-19', 'ZOMATO', -27.8],
    ['2025-12-24', 'TEMPLE DONATION', -50],
    ['2026-04-03', 'PAYROLL ACME CORP', 3300],
    ['2026-04-04', 'RENT PAYMENT', -1450],
    ['2026-04-07', 'INDIAN OIL PETROL', -55],
    ['2026-04-10', 'JIO FIBER BROADBAND', -79],
    ['2026-04-14', 'SIP GROWW MUTUAL FUND', -500],
    ['2026-04-18', 'MAID DOMESTIC HELP', -300],
    ['2026-05-03', 'PAYROLL ACME CORP', 3300],
    ['2026-05-04', 'RENT PAYMENT', -1450],
    ['2026-05-08', 'AMUL MILK', -12.4],
    ['2026-05-12', 'METRO CARD RECHARGE', -40],
    ['2026-05-16', 'PPF CONTRIBUTION', -1000],
    ['2026-05-20', 'SCHOOL FEE', -750],
    ['2026-06-03', 'PAYROLL ACME CORP', 3300],
    ['2026-06-04', 'HOME LOAN EMI', -1800],
    ['2026-06-09', 'VEGETABLE MARKET', -26.5],
    ['2026-06-14', 'NETFLIX.COM', -15.49],
    ['2026-06-18', 'FIXED DEPOSIT', -2000],
    ['2026-07-03', 'PAYROLL ACME CORP', 3300],
    ['2026-07-04', 'RENT PAYMENT', -1450],
    ['2026-07-08', 'SWIGGY INSTAMART', -64],
    ['2026-07-12', 'TATA PLAY DTH', -35],
    ['2026-07-19', 'FAMILY SUPPORT SENDING MONEY HOME', -200],
    ['2026-08-03', 'PAYROLL ACME CORP', 3300],
    ['2026-08-04', 'RENT PAYMENT', -1450],
    ['2026-08-09', 'FLIPKART', -49.9],
    ['2026-08-15', 'RECURRING DEPOSIT', -300],
    ['2026-08-22', 'HEALTH INSURANCE PREMIUM', -180],
    ['2026-09-05', 'PAYROLL ACME CORP', 3300],
    ['2026-09-07', 'SWIGGY ORDER', -36.2],
    ['2026-09-10', 'BESCOM ELECTRICITY', -82],
    ['2026-09-12', 'TRANSFER TO SAVINGS', -400],
    ['2026-09-15', 'RENT PAYMENT', -1450],
    ['2026-09-18', 'NETFLIX.COM', -15.49]
  ].map(([date, desc, raw]) => ({ date, desc, raw })));

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function categories() {
    return CATS.map(c => ({
      name: c[0],
      color: c[1],
      mark: c[3],
      group: c[4],
      role: c[5],
      label: c[6] || c[0]
    }));
  }

  function categoryGroups() {
    const grouped = new Map();
    categories().forEach(cat => {
      if (!grouped.has(cat.group)) grouped.set(cat.group, []);
      grouped.get(cat.group).push(cat);
    });
    return GROUP_ORDER.filter(name => grouped.has(name)).map(name => ({
      name,
      categories: grouped.get(name)
    }));
  }

  function canonicalCategory(name) {
    const hit = CATS.find(c => c[0].toLowerCase() === String(name || '').trim().toLowerCase());
    return hit ? hit[0] : null;
  }

  function categoryRole(name) {
    const hit = CATS.find(c => c[0] === name);
    return hit ? hit[5] : 'spend';
  }

  function merchant(d) {
    const original = String(d || '');
    const skip = new Set(['TO', 'FROM', 'THE', 'FOR', 'AND', 'OF', 'AT', 'WITH', 'A', 'AN', 'COM', 'WWW']);
    let s = original.toUpperCase()
      .replace(/\b(POS|DEBIT|CREDIT|CARD|PURCHASE|CHECKCARD|CHECK|VISA|ACH|WITHDRAWAL|RECURRING|PMT|PAYMENT|ONLINE|TST|SQ|PP)\b/g, ' ')
      .replace(/[#*\d\/\\:.,_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    s = s.split(' ').filter(w => w && !skip.has(w)).slice(0, 2).join(' ');
    if (!s) s = original.replace(/\s+/g, ' ').trim().slice(0, 24);
    return s.toLowerCase().replace(/(^|\s)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
  }

  const PAYEE_STOP = new Set([
    'ZELLE', 'UPI', 'PAYMENT', 'PAYMENTS', 'PAY', 'PAID', 'TO', 'FROM', 'THE', 'FOR', 'AND', 'OF',
    'AT', 'WITH', 'A', 'AN', 'THIS', 'TRANSFER', 'TRANSFERRED', 'SENT', 'SEND', 'RECEIVED',
    'PHONEPE', 'GPAY', 'GOOGLE', 'VENMO', 'PAYPAL', 'CASH', 'APP', 'NEFT', 'IMPS', 'ACH', 'PMT',
    'ONLINE', 'REF', 'REFERENCE', 'CONFIRMATION', 'CONF', 'ID', 'TXN', 'TRANSACTION', 'RECHARGE',
    'MEMO', 'NOTE', 'WWW', 'COM', 'OKAXIS', 'OKHDFCBANK', 'OKSBI', 'YBL', 'IBL', 'AXL', 'PAYTM', 'PTYES'
  ]);

  function payeeKey(desc) {
    const text = String(desc || '')
      .replace(/(\d)(?=[A-Za-z])/g, '$1 ')
      .replace(/[\/_|]+/g, ' ');
    const tokens = text.split(/[^A-Za-z0-9']+/).filter(Boolean);
    const name = [];
    for (const token of tokens) {
      const upper = token.toUpperCase().replace(/'/g, '');
      if (!upper) continue;
      if (/\d/.test(upper) || upper.length < 2) {
        if (name.length) break;
        continue;
      }
      if (PAYEE_STOP.has(upper) || /^OK[A-Z]{2,}$/.test(upper)) {
        if (name.length) break;
        continue;
      }
      name.push(upper.toLowerCase());
      if (name.length >= 3) break;
    }
    return name.join(' ');
  }

  function payeeLabel(desc) {
    return payeeKey(desc).replace(/(^|\s)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
  }

  function amountCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.abs(n) * 100);
  }

  function withinAmountBand(a, b) {
    const left = amountCents(a);
    const right = amountCents(b);
    if (left == null || right == null) return false;
    return Math.abs(left - right) <= 1000;
  }

  function normalizeSimilar(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach(rule => {
      const payee = payeeKey(rule && (rule.p || rule.payee)) || String(rule && (rule.p || rule.payee) || '').trim().toLowerCase();
      const amount = round2(Math.abs(Number(rule && (rule.a != null ? rule.a : rule.amount))));
      const category = canonicalCategory(rule && (rule.c || rule.category));
      if (!payee || !category || !Number.isFinite(amount)) return;
      const dup = out.findIndex(item => item.p === payee && withinAmountBand(item.a, amount));
      const next = { p: payee, a: amount, c: category };
      if (dup >= 0) out[dup] = next;
      else out.push(next);
    });
    return out;
  }

  function upsertSimilar(rules, payee, amount, category) {
    const known = canonicalCategory(category);
    const key = payeeKey(payee) || String(payee || '').trim().toLowerCase();
    const anchor = round2(Math.abs(Number(amount)));
    if (!known || !key || !Number.isFinite(anchor)) return normalizeSimilar(rules);
    return normalizeSimilar([...(rules || []).filter(rule => !(rule.p === key && withinAmountBand(rule.a, anchor))), { p: key, a: anchor, c: known }]);
  }

  function similarCategory(txn, rules) {
    const payee = payeeKey(txn && txn.desc);
    const amount = txn && txn.raw;
    if (!payee || !Array.isArray(rules)) return null;
    let best = null;
    let bestDist = Infinity;
    rules.forEach(rule => {
      if (!rule || rule.p !== payee) return;
      if (!withinAmountBand(amount, rule.a)) return;
      const dist = Math.abs((amountCents(amount) || 0) - (amountCents(rule.a) || 0));
      if (dist < bestDist) {
        best = rule.c;
        bestDist = dist;
      }
    });
    return best;
  }

  function autoCategory(desc) {
    const text = String(desc || '');
    for (const c of CATS) {
      if (c[2].test(text)) return c[0];
    }
    return 'Other';
  }

  function categoryOf(txn, rules, similar) {
    const own = canonicalCategory(txn && txn.oc);
    if (own) return own;
    const key = txn && txn.m;
    if (key && rules && rules[key]) {
      const known = canonicalCategory(rules[key]);
      if (known) return known;
    }
    const band = similarCategory(txn, similar);
    if (band) return band;
    return autoCategory(txn && txn.desc);
  }

  function validDate(y, m, d) {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
    if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function parseDate(s, fallbackYear) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) {
      return validDate(+m[1], +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return validDate(y, +m[1], +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/))) {
      return validDate(fallbackYear, +m[1], +m[2]);
    }
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/))) {
      const mo = MON[m[1].toLowerCase()];
      if (!mo) return null;
      return validDate(m[3] ? +m[3] : fallbackYear, mo, +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*(?:[- ,]+(\d{2,4}))?$/))) {
      const mo = MON[m[2].toLowerCase()];
      if (!mo) return null;
      let y = m[3] ? +m[3] : fallbackYear;
      if (y < 100) y += 2000;
      return validDate(y, mo, +m[1]);
    }
    return null;
  }

  function formatMonth(ym, long) {
    const parts = String(ym || '').split('-');
    const y = +parts[0];
    const m = +parts[1];
    if (!y || !m) return String(ym || '');
    // Local calendar date. `new Date('YYYY-MM-01')` is UTC and shifts a day
    // behind in the Americas.
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString('en-US', { month: long ? 'long' : 'short', year: 'numeric' });
  }

  function monthTick(ym, withYear) {
    const parts = String(ym || '').split('-');
    const y = +parts[0];
    const m = +parts[1];
    if (!y || !m) return String(ym || '');
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString('en-US', withYear
      ? { month: 'short', year: '2-digit' }
      : { month: 'short' });
  }

  function parseMoney(token) {
    if (token == null) return NaN;
    let s = String(token).trim();
    if (!s || s === '-' || s === '—') return NaN;
    const paren = /^\(.*\)$/.test(s);
    let trailMinus = false;
    if (!paren && /-$/.test(s)) {
      trailMinus = true;
      s = s.replace(/-$/, '').trim();
    }
    let suffix = null;
    const suf = s.match(/\s*(CR|DR|DB)\s*$/i);
    if (suf) {
      suffix = suf[1].toUpperCase();
      s = s.slice(0, suf.index).trim();
    }
    if (paren) s = s.replace(/^\(/, '').replace(/\)$/, '').trim();
    const leadingMinus = /^[-−]/.test(s);
    s = s.replace(/^[-−+]/, '').replace(/\$/g, '').replace(/\s/g, '');
    let numStr;
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
      numStr = s.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = s.replace(/,/g, '');
    }
    if (!/^\d+(\.\d+)?$/.test(numStr)) return NaN;
    const n = parseFloat(numStr);
    if (!Number.isFinite(n)) return NaN;
    if (suffix === 'CR') return round2(Math.abs(n));
    if (paren || trailMinus || suffix === 'DR' || suffix === 'DB' || leadingMinus) return round2(-Math.abs(n));
    return round2(n);
  }

  function looksLikeMoney(token) {
    const s = String(token ?? '').trim();
    if (!s || s.length > 40) return false;
    if (/^20\d{2}$/.test(s)) return false;
    if (parseDate(s, 2000)) return false;
    return Number.isFinite(parseMoney(s));
  }

  function detectDelimiter(text) {
    const sample = text.slice(0, 8000);
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
      const c = sample[i];
      if (c === '"') {
        if (inQuotes && sample[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      } else if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, c)) {
        counts[c]++;
      }
    }
    if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
    if (counts[';'] > counts[',']) return ';';
    return ',';
  }

  function parseCsvTable(text) {
    const cleaned = String(text || '').replace(/^\uFEFF/, '');
    const delimiter = detectDelimiter(cleaned);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (inQuotes) {
        if (c === '"') {
          if (cleaned[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delimiter) {
        row.push(cell.trim());
        cell = '';
      } else if (c === '\n') {
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = '';
      } else if (c !== '\r') {
        cell += c;
      }
    }
    if (cell.length || row.length) {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
    }
    return rows;
  }

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[_./]+/g, ' ').replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function headerIndex(names, ranks) {
    let best = 99;
    let idx = -1;
    names.forEach((n, i) => {
      const rank = ranks.indexOf(n);
      if (rank !== -1 && rank < best) { best = rank; idx = i; }
    });
    return idx;
  }

  function mapHeaders(cells) {
    const names = cells.map(normHeader);
    if (!names.some(Boolean)) return null;
    let dateIdx = headerIndex(names, DATE_RANKS);
    if (dateIdx === -1) dateIdx = names.findIndex(n => /(^| )date($| )/.test(n));
    let amountIdx = names.findIndex(n => AMOUNT_NAMES.has(n));
    if (amountIdx === -1) amountIdx = names.findIndex(n => n.includes('amount') && !n.includes('balance'));
    const debitIdx = names.findIndex(n => DEBIT_NAMES.has(n));
    const creditIdx = names.findIndex(n => CREDIT_NAMES.has(n));
    const balanceIdx = names.findIndex(n => BALANCE_NAMES.has(n) || (n.includes('balance') && !n.includes('amount')));
    const descIdx = headerIndex(names, DESC_RANKS);
    const catIdx = names.findIndex(n => n === 'category');
    if (dateIdx === -1) return null;
    if (amountIdx === -1 && debitIdx === -1 && creditIdx === -1) return null;
    return { dateIdx, amountIdx, debitIdx, creditIdx, balanceIdx, descIdx, catIdx };
  }

  function findHeader(rows) {
    const limit = Math.min(rows.length, 25);
    for (let i = 0; i < limit; i++) {
      const mapping = mapHeaders(rows[i]);
      if (mapping) return { index: i, mapping };
    }
    return null;
  }

  function inferYear(rows) {
    let y = null;
    for (const cols of rows) {
      for (const c of cols) {
        const m = String(c).match(/\b(20\d{2})\b/);
        if (m) y = Math.max(y || 0, +m[1]);
      }
    }
    return y || new Date().getFullYear();
  }

  function combineDebitCredit(debitCell, creditCell) {
    const d = parseMoney(debitCell);
    const c = parseMoney(creditCell);
    const hasD = Number.isFinite(d) && d !== 0;
    const hasC = Number.isFinite(c) && c !== 0;
    if (!hasD && !hasC) return NaN;
    let raw = 0;
    if (hasD) raw -= Math.abs(d);
    if (hasC) raw += Math.abs(c);
    return round2(raw);
  }

  function rowFromMapping(cols, mapping, year) {
    const date = parseDate(cols[mapping.dateIdx], year);
    if (!date) return null;
    let raw = NaN;
    if (mapping.amountIdx >= 0) {
      const cell = cols[mapping.amountIdx] || '';
      if (String(cell).trim()) raw = parseMoney(cell);
    }
    if (!Number.isFinite(raw) && (mapping.debitIdx >= 0 || mapping.creditIdx >= 0)) {
      raw = combineDebitCredit(
        mapping.debitIdx >= 0 ? cols[mapping.debitIdx] : '',
        mapping.creditIdx >= 0 ? cols[mapping.creditIdx] : ''
      );
    }
    if (!Number.isFinite(raw)) return null;
    let desc = mapping.descIdx >= 0 ? (cols[mapping.descIdx] || '') : '';
    if (!String(desc).trim()) {
      const skip = new Set([mapping.dateIdx, mapping.amountIdx, mapping.debitIdx, mapping.creditIdx, mapping.catIdx, mapping.balanceIdx]);
      desc = cols.filter((c, i) => !skip.has(i) && c && !looksLikeMoney(c) && !parseDate(c, year)).join(' ');
    }
    desc = String(desc).replace(/\s+/g, ' ').trim() || 'Unknown';
    const txn = { date, desc, raw: round2(raw) };
    if (mapping.catIdx >= 0) {
      const category = canonicalCategory(cols[mapping.catIdx]);
      if (category) txn.category = category;
    }
    return txn;
  }

  function headerlessTransactions(rows, year) {
    const candidates = [];
    rows.forEach(cols => {
      if (!cols || !cols.length) return;
      const date = parseDate(cols[0], year);
      if (!date) return;
      const moneyIdxs = [];
      cols.forEach((c, i) => { if (i > 0 && looksLikeMoney(c)) moneyIdxs.push(i); });
      if (!moneyIdxs.length) return;
      candidates.push({ cols, date, moneyIdxs });
    });
    if (!candidates.length) return [];
    let balanceAtEnd = false;
    if (candidates.length >= 2 && candidates.every(c => c.moneyIdxs.length >= 2)) {
      let hits = 0;
      let checks = 0;
      for (let i = 1; i < candidates.length; i++) {
        const prev = candidates[i - 1];
        const cur = candidates[i];
        const prevBal = parseMoney(prev.cols[prev.moneyIdxs[prev.moneyIdxs.length - 1]]);
        const curBal = parseMoney(cur.cols[cur.moneyIdxs[cur.moneyIdxs.length - 1]]);
        const curAmt = parseMoney(cur.cols[cur.moneyIdxs[cur.moneyIdxs.length - 2]]);
        if (![prevBal, curBal, curAmt].every(Number.isFinite)) continue;
        checks++;
        const delta = round2(curBal - prevBal);
        if (Math.abs(delta - curAmt) < 0.02 || Math.abs(delta + curAmt) < 0.02) hits++;
      }
      if (checks && hits / checks >= 0.6) balanceAtEnd = true;
    }
    return candidates.map(c => {
      const idxs = c.moneyIdxs;
      const amountIdx = balanceAtEnd && idxs.length >= 2 ? idxs[idxs.length - 2] : idxs[idxs.length - 1];
      const ignore = new Set([0, amountIdx]);
      if (balanceAtEnd && idxs.length >= 2) ignore.add(idxs[idxs.length - 1]);
      const desc = c.cols
        .filter((cell, i) => !ignore.has(i) && cell && !looksLikeMoney(cell))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
      return { date: c.date, desc, raw: round2(parseMoney(c.cols[amountIdx])) };
    }).filter(t => Number.isFinite(t.raw));
  }

  function parseCsv(text) {
    const rows = parseCsvTable(text);
    const hint = 'Expected a date and an amount (headers like Date, Description, Amount — or Debit and Credit). A headerless file should be date, description, amount.';
    if (!rows.length) return { txns: [], skipped: 0, hint };
    const year = inferYear(rows);
    const header = findHeader(rows);
    if (!header) {
      const txns = headerlessTransactions(rows, year);
      return { txns, skipped: 0, hint: txns.length ? '' : hint };
    }
    const txns = [];
    let skipped = 0;
    for (let i = header.index + 1; i < rows.length; i++) {
      const txn = rowFromMapping(rows[i], header.mapping, year);
      if (txn) txns.push(txn);
      else if (rows[i].some(Boolean)) skipped++;
    }
    return { txns, skipped, hint: txns.length ? '' : hint };
  }

  function parseStatementLines(lines, year) {
    const fallback = year || new Date().getFullYear();
    const out = [];
    for (const line of lines || []) {
      const ln = String(line || '').replace(/\s+/g, ' ').trim();
      if (!ln || SUMMARY_LINE.test(ln)) continue;
      const m = ln.match(LINE_RE);
      if (!m) continue;
      let rest = m[2];
      const second = rest.match(SECOND_DATE_RE);
      if (second && parseDate(second[1], fallback)) rest = second[2];
      const amounts = rest.match(new RegExp(AMT_SRC, 'gi'));
      if (!amounts) continue;
      const pick = amounts.length <= 2 ? amounts[0] : amounts[amounts.length - 2];
      const date = parseDate(m[1], fallback);
      if (!date) continue;
      let desc = rest.replace(new RegExp(AMT_SRC, 'gi'), ' ').replace(/\s+/g, ' ').trim();
      if (desc.length < 2 || SUMMARY_DESC.test(desc)) continue;
      const raw = parseMoney(pick);
      if (!Number.isFinite(raw)) continue;
      out.push({ date, desc, raw });
    }
    return out;
  }

  function flow(raw, mode) {
    return mode === 'card' ? -raw : raw;
  }

  function resolveMode(txns, preference, rules) {
    if (preference === 'bank' || preference === 'card') return preference;
    let neg = 0;
    let pos = 0;
    let voteNeg = 0;
    let votePos = 0;
    for (const t of txns || []) {
      if (!t || !Number.isFinite(t.raw) || t.raw === 0) continue;
      if (t.raw < 0) neg++;
      else pos++;
      const m = t.m || merchant(t.desc || '');
      const c = categoryOf({ ...t, m }, rules || {});
      const role = categoryRole(c);
      if (role !== 'spend' || c === 'Other') continue;
      if (t.raw < 0) voteNeg++;
      else votePos++;
    }
    if (votePos > voteNeg) return 'card';
    if (voteNeg > votePos) return 'bank';
    return neg === 0 && pos > 0 ? 'card' : 'bank';
  }

  function isSpend(t) {
    return !!(t && t.f < 0 && categoryRole(t.c) === 'spend');
  }

  function isIncome(t) {
    if (!t || !(t.f > 0)) return false;
    const role = categoryRole(t.c);
    return role === 'income' || role === 'spend';
  }

  function isSavings(t) {
    return !!(t && categoryRole(t.c) === 'savings' && t.f < 0);
  }

  function decorate(txns, modePref, rules, similar) {
    const prepared = (txns || []).map(t => ({ ...t, m: t.m || merchant(t.desc || '') }));
    const mode = resolveMode(prepared, modePref, rules || {});
    const rows = prepared.map(t => {
      const c = categoryOf(t, rules || {}, similar);
      return { ...t, c, f: flow(t.raw, mode) };
    });
    return { mode, rows };
  }

  function filterRows(rows, q) {
    const query = String((q && q.q) || '').trim().toLowerCase();
    const amtMin = q && q.amtMin ? Number(q.amtMin) : 0;
    const hasMax = q && q.amtMax != null && q.amtMax !== '' && Number.isFinite(Number(q.amtMax));
    const amtMax = hasMax ? Number(q.amtMax) : null;
    return (rows || []).filter(t => {
      if (q && q.dateFrom && t.date < q.dateFrom) return false;
      if (q && q.dateTo && t.date > q.dateTo) return false;
      const abs = Math.abs(t.f);
      if (abs < amtMin) return false;
      if (amtMax != null && abs > amtMax) return false;
      if (q && q.cat && t.c !== q.cat) return false;
      if (query) {
        const hay = (t.desc + ' ' + t.m + ' ' + t.c).toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  function categoryTotals(rows) {
    const map = {};
    rows.filter(isSpend).forEach(t => {
      map[t.c] = round2((map[t.c] || 0) + (-t.f));
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  function summarizeMonths(rows) {
    const map = new Map();
    for (const t of rows || []) {
      const month = String(t.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!map.has(month)) map.set(month, { month, income: 0, spend: 0, savings: 0, count: 0 });
      const item = map.get(month);
      item.count += 1;
      if (isSpend(t)) item.spend = round2(item.spend + (-t.f));
      else if (isIncome(t)) item.income = round2(item.income + t.f);
      if (categoryRole(t.c) === 'savings') item.savings = round2(item.savings + (-t.f));
    }
    return [...map.values()].map(item => ({
      ...item,
      net: round2(item.income - item.spend - item.savings)
    })).sort((a, b) => a.month.localeCompare(b.month));
  }

  function topSpendMerchant(rows) {
    const map = {};
    rows.filter(isSpend).forEach(t => {
      map[t.m] = round2((map[t.m] || 0) + (-t.f));
    });
    const top = Object.entries(map).sort((a, b) => b[1] - a[1])[0];
    return top ? { name: top[0], amount: top[1] } : null;
  }

  function largestPurchase(rows) {
    let best = null;
    rows.filter(isSpend).forEach(t => {
      if (!best || -t.f > -best.f) best = t;
    });
    return best;
  }

  function monthOverMonth(months) {
    if (!months || months.length < 2) return null;
    const cur = months[months.length - 1];
    const prev = months[months.length - 2];
    const delta = round2(cur.spend - prev.spend);
    const pct = prev.spend ? round2((delta / prev.spend) * 100) : null;
    return { cur, prev, delta, pct };
  }

  function recurringMerchants(rows) {
    const map = {};
    rows.filter(isSpend).forEach(t => {
      const item = map[t.m] || (map[t.m] = { name: t.m, category: t.c, months: new Set(), total: 0 });
      item.months.add(String(t.date).slice(0, 7));
      item.total = round2(item.total + (-t.f));
      item.category = t.c;
    });
    return Object.values(map)
      .filter(item => item.months.size >= 2)
      .map(item => ({
        name: item.name,
        category: item.category,
        months: item.months.size,
        total: item.total,
        avg: round2(item.total / item.months.size)
      }))
      .sort((a, b) => b.total - a.total);
  }

  function summarize(rows) {
    const list = rows || [];
    const spendRows = list.filter(isSpend);
    const incomeRows = list.filter(isIncome);
    const totalSpend = round2(spendRows.reduce((sum, t) => sum + (-t.f), 0));
    const totalIncome = round2(incomeRows.reduce((sum, t) => sum + t.f, 0));
    const totalSavings = round2(list.reduce((sum, t) => (
      categoryRole(t.c) === 'savings' ? sum + (-t.f) : sum
    ), 0));
    const net = round2(totalIncome - totalSpend - totalSavings);
    const cats = categoryTotals(list);
    const months = summarizeMonths(list);
    return {
      totalSpend,
      totalIncome,
      totalSavings,
      net,
      avg: spendRows.length ? round2(totalSpend / spendRows.length) : 0,
      savingsRate: totalIncome ? round2((net / totalIncome) * 100) : null,
      spendCount: spendRows.length,
      incomeCount: incomeRows.length,
      topCategory: cats[0] ? { name: cats[0][0], amount: cats[0][1] } : null,
      categories: cats,
      topMerchant: topSpendMerchant(list),
      largest: largestPurchase(list),
      months,
      mom: monthOverMonth(months),
      recurring: recurringMerchants(list)
    };
  }

  function monthsByYear(rows) {
    const months = summarizeMonths(rows);
    const map = new Map();
    months.forEach(item => {
      const year = item.month.slice(0, 4);
      if (!map.has(year)) map.set(year, { year, months: [], income: 0, spend: 0, savings: 0 });
      const bucket = map.get(year);
      bucket.months.push(item);
      bucket.income = round2(bucket.income + item.income);
      bucket.spend = round2(bucket.spend + item.spend);
      bucket.savings = round2(bucket.savings + item.savings);
    });
    return [...map.values()].map(bucket => ({
      ...bucket,
      net: round2(bucket.income - bucket.spend - bucket.savings),
      months: bucket.months.slice().sort((a, b) => b.month.localeCompare(a.month))
    })).sort((a, b) => b.year.localeCompare(a.year));
  }

  function daysInMonth(ym) {
    const parts = String(ym || '').split('-');
    const y = +parts[0];
    const m = +parts[1];
    if (!y || !m) return 30;
    return new Date(y, m, 0).getDate();
  }

  function defaultPeriod(months, today) {
    const list = [...new Set(months || [])].filter(month => /^\d{4}-\d{2}$/.test(month)).sort();
    if (!list.length) return '';
    const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
    const current = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    return list.includes(current) ? current : list[list.length - 1];
  }

  function projections(rows, today, focusMonth) {
    const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
    const calendarMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const months = summarizeMonths(rows);
    if (focusMonth && /^\d{4}-\d{2}$/.test(focusMonth)) {
      const focus = months.find(item => item.month === focusMonth) || null;
      const dim = daysInMonth(focusMonth);
      const elapsed = focusMonth === calendarMonth ? Math.min(now.getDate(), dim) : dim;
      const extend = (amount) => {
        const value = amount || 0;
        if (!focus || focusMonth !== calendarMonth || elapsed < 1) return round2(value);
        return round2(value / elapsed * dim);
      };
      const monthSpend = extend(focus && focus.spend);
      const monthIncome = extend(focus && focus.income);
      const monthSavings = extend(focus && focus.savings);
      return {
        estimate: true,
        scoped: true,
        finished: focusMonth < calendarMonth,
        currentMonth: focusMonth,
        currentLabel: formatMonth(focusMonth, true),
        elapsed: focusMonth > calendarMonth ? 0 : elapsed,
        days: dim,
        spentSoFar: focus ? focus.spend : 0,
        incomeSoFar: focus ? focus.income : 0,
        savedSoFar: focus ? focus.savings : 0,
        projectedMonthSpend: focus ? monthSpend : null,
        projectedMonthIncome: focus ? monthIncome : null,
        projectedMonthSavings: focus ? monthSavings : null,
        averageMonthSpend: monthSpend,
        averageMonthIncome: monthIncome,
        averageMonthSavings: monthSavings,
        projectedYearSpend: round2(monthSpend * 12),
        projectedYearIncome: round2(monthIncome * 12),
        projectedYearSavings: round2(monthSavings * 12),
        basedOn: [focusMonth]
      };
    }
    const elapsed = now.getDate();
    const dim = daysInMonth(calendarMonth);
    const current = months.find(item => item.month === calendarMonth) || null;
    const finished = months.filter(item => item.month < calendarMonth);
    const recent = finished.slice(-3);
    const average = key => recent.length
      ? round2(recent.reduce((sum, item) => sum + item[key], 0) / recent.length)
      : 0;
    const pace = (amount) => {
      if (!current || elapsed < 1) return null;
      if (!amount) return null;
      return round2(amount / Math.min(elapsed, dim) * dim);
    };
    const avgSpend = average('spend');
    const avgIncome = average('income');
    const avgSavings = average('savings');
    return {
      estimate: true,
      currentMonth: calendarMonth,
      currentLabel: formatMonth(calendarMonth, true),
      elapsed,
      days: dim,
      spentSoFar: current ? current.spend : 0,
      incomeSoFar: current ? current.income : 0,
      savedSoFar: current ? current.savings : 0,
      projectedMonthSpend: pace(current && current.spend),
      projectedMonthIncome: pace(current && current.income),
      projectedMonthSavings: pace(current && current.savings),
      averageMonthSpend: avgSpend,
      averageMonthIncome: avgIncome,
      averageMonthSavings: avgSavings,
      projectedYearSpend: round2(avgSpend * 12),
      projectedYearIncome: round2(avgIncome * 12),
      projectedYearSavings: round2(avgSavings * 12),
      basedOn: recent.map(item => item.month)
    };
  }

  function csvCell(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(rows) {
    const lines = ['Date,Description,Merchant,Category,Amount'];
    for (const t of rows || []) {
      lines.push([t.date, t.desc, t.m, t.c, Number(t.f).toFixed(2)].map(csvCell).join(','));
    }
    return lines.join('\n');
  }

  function spendCategoryNames() {
    return CATS.filter(c => c[5] === 'spend').map(c => c[0]);
  }

  function normalizeBudgets(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(key => {
      const name = canonicalCategory(key);
      const amount = Number(raw[key]);
      if (!name || categoryRole(name) !== 'spend') return;
      if (!Number.isFinite(amount) || amount <= 0) return;
      out[name] = round2(amount);
    });
    return out;
  }

  function normalizeGoals(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(goal => {
      const name = String(goal && goal.name || '').trim().slice(0, 80);
      const target = round2(Number(goal && goal.target));
      const saved = round2(Number(goal && goal.saved));
      if (!name || !Number.isFinite(target) || target <= 0) return null;
      const deadline = goal && goal.deadline ? parseDate(goal.deadline, new Date().getFullYear()) : '';
      return {
        id: String(goal.id || uid()),
        name,
        target,
        saved: Number.isFinite(saved) && saved > 0 ? saved : 0,
        deadline: deadline || ''
      };
    }).filter(Boolean);
  }

  function goalProgress(goal) {
    const saved = goal.saved || 0;
    const ratio = goal.target ? saved / goal.target : 0;
    return {
      ...goal,
      ratio,
      left: round2(Math.max(0, goal.target - saved)),
      done: saved >= goal.target
    };
  }

  function budgetMonth(rows, range) {
    const months = summarizeMonths(rows);
    const from = range && range.dateFrom;
    const to = range && range.dateTo;
    if (from && to && from.slice(0, 7) === to.slice(0, 7) && /^\d{4}-\d{2}/.test(from)) {
      return from.slice(0, 7);
    }
    return months.length ? months[months.length - 1].month : '';
  }

  function planReport(rows, budgets, goals, range) {
    const month = budgetMonth(rows, range);
    const spent = {};
    (rows || []).filter(t => month && String(t.date).startsWith(month) && isSpend(t)).forEach(t => {
      spent[t.c] = round2((spent[t.c] || 0) + (-t.f));
    });
    const limits = normalizeBudgets(budgets);
    const statuses = Object.keys(limits).map(name => {
      const limit = limits[name];
      const amount = round2(spent[name] || 0);
      const ratio = limit ? amount / limit : 0;
      let level = 'ok';
      if (amount > limit) level = 'over';
      else if (amount < limit && ratio >= 0.8) level = 'near';
      return { name, limit, spent: amount, left: round2(limit - amount), ratio, level };
    }).sort((a, b) => b.ratio - a.ratio);
    return {
      month,
      monthLabel: month ? formatMonth(month, true) : '',
      statuses,
      alerts: statuses.filter(item => item.level !== 'ok'),
      goals: normalizeGoals(goals).map(goalProgress)
    };
  }

  function buildBackup(state) {
    return {
      version: BACKUP_VERSION,
      app: 'spending-analyzer',
      exportedAt: new Date().toISOString(),
      data: state || {}
    };
  }

  function parseBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('That file is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a backup.');
    const wrapped = parsed.data && typeof parsed.data === 'object' && (parsed.app === 'spending-analyzer' || parsed.version);
    const data = wrapped ? parsed.data : parsed;
    const txns = data.t || data.txns || data.transactions;
    const hasPlans = data.b || data.budgets || data.g || data.goals;
    if (!Array.isArray(txns) && !hasPlans) {
      throw new Error('That file does not look like a Spending Analyzer backup.');
    }
    return {
      t: Array.isArray(txns) ? txns : [],
      r: data.r || data.rules || {},
      m: data.m || data.mode || 'auto',
      f: data.f || '',
      to: data.to || '',
      amn: data.amn,
      amx: data.amx,
      th: data.th || data.theme || 'auto',
      sm: data.sm || '',
      v: data.v || 'tx',
      b: normalizeBudgets(data.b || data.budgets),
      g: normalizeGoals(data.g || data.goals),
      sr: normalizeSimilar(data.sr || data.similar)
    };
  }

  function migrate(txns, rules) {
    const nextRules = { ...(rules || {}) };
    const nextTxns = (txns || []).map(t => {
      const m = merchant(t.desc || '');
      const old = t.m;
      if (old && old !== m && nextRules[old] && !nextRules[m]) nextRules[m] = nextRules[old];
      const id = t.id || uid();
      const own = canonicalCategory(t.oc);
      const next = { ...t, id, m };
      if (own) next.oc = own;
      else delete next.oc;
      return next;
    });
    const cleaned = {};
    Object.keys(nextRules).forEach(key => {
      const known = canonicalCategory(nextRules[key]);
      if (known && String(key).trim()) cleaned[key] = known;
    });
    return { txns: nextTxns, rules: cleaned };
  }

  return {
    STORAGE_KEY,
    SAMPLE_TXNS,
    SAMPLE_HISTORY,
    round2,
    uid,
    categories,
    categoryGroups,
    canonicalCategory,
    categoryRole,
    merchant,
    payeeKey,
    payeeLabel,
    withinAmountBand,
    normalizeSimilar,
    upsertSimilar,
    similarCategory,
    autoCategory,
    categoryOf,
    parseDate,
    formatMonth,
    monthTick,
    parseMoney,
    looksLikeMoney,
    parseCsv,
    parseStatementLines,
    flow,
    resolveMode,
    isSpend,
    isIncome,
    isSavings,
    decorate,
    filterRows,
    summarize,
    summarizeMonths,
    monthsByYear,
    defaultPeriod,
    projections,
    exportCsv,
    migrate,
    BACKUP_VERSION,
    spendCategoryNames,
    normalizeBudgets,
    normalizeGoals,
    goalProgress,
    planReport,
    buildBackup,
    parseBackup
  };
});
