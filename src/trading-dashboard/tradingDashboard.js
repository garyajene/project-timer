const tabs = ['Account Settings', 'Live Account Simulation', 'Trade Journal', 'Goal Planner', 'Trading Psychology'];

const settings = {
  mode: 'percentage',
  startingBalance: 25000,
  dailyTargetReturn: 1.8,
  dailyDollarTarget: 450,
  reinvestmentRate: 85,
  feeType: 'percentage',
  feeValue: 0.08,
  tradingDays: 30,
  dailyLossPercentage: 0.4,
  taxes: 15,
  goalValue: 50000,
};

const journalTrades = [
  { date: '2026-07-08', symbol: 'NVDA', buy: 151.2, sell: 156.35, invested: 6500, fees: 12, notes: 'Clean breakout, followed plan.' },
  { date: '2026-07-09', symbol: 'SPY', buy: 625.1, sell: 621.85, invested: 4200, fees: 8, notes: 'Exited early after volatility spike.' },
  { date: '2026-07-10', symbol: 'TSLA', buy: 318.4, sell: 327.9, invested: 5000, fees: 10, notes: 'Waited for confirmation; strong execution.' },
  { date: '2026-07-13', symbol: 'AAPL', buy: 214.7, sell: 213.9, invested: 3500, fees: 7, notes: 'Small loss; respected stop.' },
];

let activeTradingTab = 'Account Settings';

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

function percent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function feeFor(amount) {
  return settings.feeType === 'flat' ? settings.feeValue : amount * (settings.feeValue / 100);
}

function calculateLedger() {
  let balance = settings.startingBalance;
  let runningProfit = 0;
  return Array.from({ length: settings.tradingDays }, (_, index) => {
    const day = index + 1;
    const startingBalance = balance;
    const invested = settings.mode === 'percentage' ? startingBalance * (settings.reinvestmentRate / 100) : Math.min(settings.dailyDollarTarget / Math.max(settings.dailyTargetReturn / 100, 0.0001), startingBalance);
    const isLossDay = settings.dailyLossPercentage > 0 && day % 7 === 0;
    const gross = isLossDay ? -(invested * (settings.dailyLossPercentage / 100)) : (settings.mode === 'percentage' ? invested * (settings.dailyTargetReturn / 100) : settings.dailyDollarTarget);
    const fees = feeFor(invested);
    const tax = gross > 0 ? gross * (settings.taxes / 100) : 0;
    const net = gross - fees - tax;
    balance += net * (settings.reinvestmentRate / 100);
    runningProfit = balance - settings.startingBalance;
    return { day, startingBalance, invested, gross, fees, net, endingBalance: balance, runningProfit, totalValue: balance };
  });
}

function statCard(label, value, detail = '') {
  return `<article class="td-stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`;
}

function field(label, id, value, type = 'number', extra = '') {
  return `<label>${label}<input class="text-input td-setting-input" id="${id}" type="${type}" value="${escapeHtml(value)}" ${extra} /></label>`;
}

function accountSettings() {
  return `<div class="td-grid two"><section class="project-card"><h3>Compounding inputs</h3><div class="td-form-grid"><label>Calculator Mode<select class="text-input" id="td-mode"><option value="percentage" ${settings.mode === 'percentage' ? 'selected' : ''}>Percentage Mode</option><option value="dollar" ${settings.mode === 'dollar' ? 'selected' : ''}>Dollar Amount Mode</option></select></label>${field('Starting account balance', 'td-startingBalance', settings.startingBalance)}${field('Daily target return (%)', 'td-dailyTargetReturn', settings.dailyTargetReturn, 'number', 'step="0.1"')}${field('Daily dollar target', 'td-dailyDollarTarget', settings.dailyDollarTarget)}${field('Reinvestment rate (%)', 'td-reinvestmentRate', settings.reinvestmentRate)}<label>Trading fee type<select class="text-input" id="td-feeType"><option value="percentage" ${settings.feeType === 'percentage' ? 'selected' : ''}>Percentage fee</option><option value="flat" ${settings.feeType === 'flat' ? 'selected' : ''}>Flat fee</option></select></label>${field('Trading fee value', 'td-feeValue', settings.feeValue, 'number', 'step="0.01"')}${field('Number of trading days', 'td-tradingDays', settings.tradingDays)}${field('Optional daily loss (%)', 'td-dailyLossPercentage', settings.dailyLossPercentage, 'number', 'step="0.1"')}${field('Taxes (%) optional', 'td-taxes', settings.taxes)}${field('Goal value', 'td-goalValue', settings.goalValue)}</div></section><section class="project-card" id="td-scenario-summary">${scenarioSummary()}</section></div>`;
}

function scenarioSummary() {
  return `<h3>Scenario summary</h3><p class="helper-text">This proof-of-concept keeps calculations in the browser and updates the simulation automatically as inputs change.</p>${summaryCards().join('')}<div class="td-note">Mode-aware calculations are reused by the live ledger, goal comparison, and psychology score context.</div>`;
}

function summaryCards() {
  const ledger = calculateLedger();
  const final = ledger.at(-1) || { endingBalance: settings.startingBalance, runningProfit: 0 };
  return [statCard('Projected balance', money(final.endingBalance), `${settings.tradingDays} trading days`), statCard('Projected profit', money(final.runningProfit), `${percent((final.runningProfit / settings.startingBalance) * 100)} return`), statCard('Goal progress', percent(Math.min((final.endingBalance / settings.goalValue) * 100, 100)), `${money(settings.goalValue)} target`)];
}

function sparkline(points, className = '') {
  const values = points.length ? points : [0];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const coords = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${100 - ((value - min) / range) * 84 - 8}`).join(' ');
  return `<svg class="td-chart ${className}" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${coords}" /></svg>`;
}

function liveSimulation() {
  const ledger = calculateLedger();
  const final = ledger.at(-1);
  const wins = ledger.filter((row) => row.net >= 0);
  const losses = ledger.filter((row) => row.net < 0);
  const progress = Math.min((final.totalValue / settings.goalValue) * 100, 100);
  const rows = ledger.map((row) => `<tr><td>${row.day}</td><td>${money(row.startingBalance)}</td><td>${money(row.invested)}</td><td>${money(row.gross)}</td><td>${money(row.fees)}</td><td>${money(row.net)}</td><td>${money(row.endingBalance)}</td><td>${money(row.runningProfit)}</td><td>${money(row.totalValue)}</td></tr>`).join('');
  return `<div class="td-stat-grid">${statCard('Current account balance', money(final.endingBalance))}${statCard('Total profit', money(final.runningProfit))}${statCard('Win/Loss streak', `${wins.length}W / ${losses.length}L`)}${statCard('Biggest winning day', money(Math.max(...ledger.map((r) => r.net))))}${statCard('Biggest losing day', money(Math.min(...ledger.map((r) => r.net))))}${statCard('Days remaining', String(Math.max(settings.tradingDays - ledger.length, 0)))}</div><section class="project-card"><div class="td-progress-head"><div><span>Current Account Value</span><strong>${money(final.totalValue)}</strong></div><div><span>Goal Value</span><strong>${money(settings.goalValue)}</strong></div><div><span>Percentage Complete</span><strong>${percent(progress)}</strong></div></div><div class="td-progress"><span style="width:${progress}%"></span></div></section><section class="project-card"><h3>Running account ledger</h3><div class="td-table-wrap"><table><thead><tr><th>Day</th><th>Starting</th><th>Invested</th><th>Gain/Loss</th><th>Fees</th><th>Net P/L</th><th>Ending</th><th>Running P/L</th><th>Total Value</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function journalMetrics() {
  const profits = journalTrades.map((trade) => ((trade.sell - trade.buy) / trade.buy) * trade.invested - trade.fees);
  const gains = profits.filter((p) => p > 0);
  const losses = profits.filter((p) => p < 0);
  const total = profits.reduce((sum, p) => sum + p, 0);
  return { profits, total, gains, losses };
}

function tradeJournal() {
  const m = journalMetrics();
  const rows = journalTrades.map((trade, index) => { const profit = m.profits[index]; return `<tr><td>${trade.date}</td><td>${trade.symbol}</td><td>${money(trade.buy)}</td><td>${money(trade.sell)}</td><td>${money(trade.invested)}</td><td>${money(profit)}</td><td>${money(trade.fees)}</td><td>${escapeHtml(trade.notes)}</td></tr>`; }).join('');
  return `<div class="td-stat-grid">${statCard('Running P/L', money(m.total))}${statCard('Win rate', percent((m.gains.length / journalTrades.length) * 100))}${statCard('Average gain', money(m.gains.reduce((a,b)=>a+b,0)/(m.gains.length||1)))}${statCard('Average loss', money(m.losses.reduce((a,b)=>a+b,0)/(m.losses.length||1)))}${statCard('Largest gain', money(Math.max(...m.profits)))}${statCard('Largest loss', money(Math.min(...m.profits)))}${statCard('Total Return', percent((m.total / settings.startingBalance) * 100))}${statCard('Profit Factor', (Math.abs(m.gains.reduce((a,b)=>a+b,0) / (m.losses.reduce((a,b)=>a+b,0)||-1))).toFixed(2))}</div><section class="project-card"><h3>Log a trade</h3><div class="td-form-grid compact">${['Date','Security / ticker','Buy price','Sell price','Amount invested','Profit or loss','Trading fees','Notes'].map((label) => `<label>${label}<input class="text-input" placeholder="${label}" /></label>`).join('')}</div></section><section class="project-card"><h3>Trade journal</h3><div class="td-table-wrap"><table><thead><tr><th>Date</th><th>Symbol</th><th>Buy</th><th>Sell</th><th>Invested</th><th>P/L</th><th>Fees</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function goalPlanner() {
  const required = ((settings.goalValue / settings.startingBalance) ** (1 / settings.tradingDays) - 1) * 100;
  const planned = Array.from({ length: settings.tradingDays }, (_, i) => settings.startingBalance * ((1 + required / 100) ** (i + 1)));
  const actual = calculateLedger().map((r) => r.totalValue);
  const missedDay = 15;
  const missedBalance = planned[missedDay - 1] * 0.97;
  const recovery = ((settings.goalValue / missedBalance) ** (1 / (settings.tradingDays - missedDay)) - 1) * 100;
  const rows = planned.map((value, index) => `<tr><td>${index + 1}</td><td>${money(value)}</td><td>${money(actual[index] || actual.at(-1))}</td><td>${(actual[index] || 0) >= value ? 'Ahead' : 'Behind'}</td></tr>`).join('');
  const completion = new Date(); completion.setDate(completion.getDate() + settings.tradingDays);
  return `<div class="td-stat-grid">${statCard('Required daily return', percent(required))}${statCard('Total profit required', money(settings.goalValue - settings.startingBalance))}${statCard('Estimated completion date', completion.toLocaleDateString())}${statCard('Recovery return after Day 15 miss', percent(recovery), 'If a -3% loss occurs')}</div><section class="project-card"><h3>Planned vs. actual growth</h3><div class="td-comparison-chart">${sparkline(planned, 'planned')}${sparkline(actual, 'actual')}<div class="td-legend"><span class="planned-line">Planned Account Growth</span><span class="actual-line">Actual Account Growth</span></div></div></section><section class="project-card"><h3>Goal roadmap</h3><div class="td-table-wrap"><table><thead><tr><th>Day</th><th>Expected balance</th><th>Actual simulation</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function psychology() {
  const rules = ['Never risk more than 1% per trade.', 'Never move my stop loss.', 'Only trade my setup.', 'No revenge trading.', 'Follow the plan, not my emotions.'];
  return `<div class="td-grid two"><section class="project-card"><h3>Pre-Trade Checklist</h3><div class="td-form-grid compact">${['Why am I taking this trade?','Does this trade follow my trading plan?','Entry','Stop loss','Profit target','Risk-to-reward ratio'].map((label) => `<label>${label}<input class="text-input" placeholder="${label}" /></label>`).join('')}<label>Current emotion<select class="text-input"><option>Calm</option><option>Confident</option><option>Anxious</option><option>Fearful</option><option>Greedy</option><option>Frustrated</option><option>Revenge trading</option><option>FOMO</option><option>Other</option></select></label></div><h3>Personal rules</h3>${rules.map((rule) => `<label class="td-check"><input type="checkbox" /> ${rule}</label>`).join('')}</section><section class="project-card"><h3>Trader Score</h3><div class="td-score">86<span>/100</span></div><p class="helper-text">Score emphasizes discipline: plan adherence, stop-loss obedience, position sizing, emotional control, journal completion, rule compliance, and consistency over time.</p>${sparkline([72,78,75,83,86,84,86])}</section></div><div class="td-grid two"><section class="project-card"><h3>Post-Trade Reflection</h3><div class="td-form-grid compact">${['Did I follow my trading plan?','Was this trade successful?','If not, why?','Most influential emotion','What did I do well?','What mistake did I make?','What will I improve next trade?','Would I take this same trade again?'].map((label) => `<label>${label}<input class="text-input" placeholder="${label}" /></label>`).join('')}</div></section><section class="project-card"><h3>Behavioral analytics</h3><div class="td-behavior-list">${['Trades following the plan: 82%','Impulsive trades: 9%','FOMO trades: 6%','Revenge trades: 2%','Rule violations: 4%','Exited too early: 14%','Emotional state vs profitability: Calm trades outperform anxious trades'].map((item) => `<span>${item}</span>`).join('')}</div></section></div><section class="project-card"><h3>Trading Psychology Library</h3><div class="td-library"><article><strong>Thinking in probabilities</strong><p>Inspired by Mark Douglas concepts: judge process quality over any single trade outcome.</p></article><article><strong>Building confidence through consistency</strong><p>Inspired by Brett Steenbarger: review behavior patterns and deliberately practice repeatable habits.</p></article><article><strong>Risk management and discipline</strong><p>Inspired by Ian Dunlap: respect position sizing, predefined exits, and long-term consistency.</p></article></div><p class="helper-text">Educational self-reflection only. This proof-of-concept does not provide personalized financial or investment advice.</p></section>`;
}

function panelForTab() {
  if (activeTradingTab === 'Live Account Simulation') return liveSimulation();
  if (activeTradingTab === 'Trade Journal') return tradeJournal();
  if (activeTradingTab === 'Goal Planner') return goalPlanner();
  if (activeTradingTab === 'Trading Psychology') return psychology();
  return accountSettings();
}

export function tradingDashboardSection() {
  return `<section id="trading-dashboard" class="panel trading-dashboard"><div class="section-heading"><div><p class="eyebrow">Proof of concept</p><h2>Trading Dashboard</h2><p class="helper-text">Self-contained workflow prototype for account compounding, simulation, journaling, goal planning, and trading psychology.</p></div></div><div class="calendar-tabs td-tabs">${tabs.map((tab) => `<button class="${activeTradingTab === tab ? 'active-tab' : ''}" data-trading-tab="${escapeHtml(tab)}">${escapeHtml(tab)}</button>`).join('')}</div>${panelForTab()}</section>`;
}

export function bindTradingDashboardEvents(render) {
  document.querySelectorAll('[data-trading-tab]').forEach((button) => button.addEventListener('click', (event) => { activeTradingTab = event.currentTarget.dataset.tradingTab; render(); }));
  const updateVisibleCalculations = () => {
    const summary = document.querySelector('#td-scenario-summary');
    if (summary) summary.innerHTML = scenarioSummary();
  };
  document.querySelectorAll('.td-setting-input').forEach((input) => input.addEventListener('input', (event) => {
    const nextValue = Number(event.target.value);
    if (!Number.isFinite(nextValue)) return;
    settings[event.target.id.replace('td-', '')] = nextValue;
    updateVisibleCalculations();
  }));
  document.querySelector('#td-mode')?.addEventListener('change', (event) => { settings.mode = event.target.value; updateVisibleCalculations(); });
  document.querySelector('#td-feeType')?.addEventListener('change', (event) => { settings.feeType = event.target.value; updateVisibleCalculations(); });
}
