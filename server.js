const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Ticker Lists
const US_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'BRK-B', 'LLY', 'AVGO',
  'TSLA', 'JPM', 'V', 'UNH', 'MA', 'COST', 'PG', 'HD', 'NFLX', 'AMD',
  'ADBE', 'QCOM', 'TXN', 'AMAT', 'MU', 'LRCX', 'INTC', 'ASML', 'PANW', 'CRWD',
  'PLTR', 'COIN', 'SMCI', 'ARM', 'HOOD', 'SOFI', 'MARA', 'RIOT', 'SQ', 'PYPL',
  'SHOP', 'SE', 'MELI', 'OKTA', 'NET', 'SNOW', 'DDOG', 'MDB', 'ZS', 'PATH',
  'U', 'AFRM', 'UPST', 'NIO', 'LI', 'XPEV', 'F', 'GM', 'TSMC'
];

const IN_TICKERS = [
  'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'BHARTIARTL.NS', 'SBIN.NS',
  'LICHSGFIN.NS', 'LICI.NS', 'ITC.NS', 'HINDUNILVR.NS', 'LT.NS', 'AXISBANK.NS', 'KOTAKBANK.NS',
  'BAJFINANCE.NS', 'BAJAJFINSV.NS', 'HCLTECH.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'ADANIENT.NS',
  'ADANIPORTS.NS', 'TATAMOTORS.NS', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'GRASIM.NS', 'ULTRACEMCO.NS',
  'NTPC.NS', 'POWERGRID.NS', 'ONGC.NS', 'COALINDIA.NS', 'IOC.NS', 'BPCL.NS', 'HPCL.NS',
  'HINDALCO.NS', 'VEDL.NS', 'WIPRO.NS', 'TECHM.NS', 'APOLLOHOSP.NS', 'CIPLA.NS', 'DRREDDY.NS',
  'DIVISLAB.NS', 'HEROMOTOCO.NS', 'EICHERMOT.NS', 'BAJAJ-AUTO.NS', 'M&M.NS', 'INDUSINDBK.NS',
  'TITAN.NS', 'UPL.NS', 'ADANIPOWER.NS', 'TATAELXSI.NS', 'DIXON.NS', 'HAL.NS', 'BEL.NS',
  'RVNL.NS', 'IRFC.NS', 'REC.NS', 'PFC.NS', 'IREDA.NS', 'ZOMATO.NS', 'PAYTM.NS', 'NYKAA.NS',
  'JIOFIN.NS'
];

// Helper to limit concurrent promises
async function runBatches(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchPromises = batch.map(fn);
    const batchResults = await Promise.allSettled(batchPromises);
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
  }
  return results;
}

// Extract numeric value from marketCap object or number
function getMarketCap(summary) {
  const cap = summary?.summaryDetail?.marketCap;
  if (cap === null || cap === undefined) return 0;
  if (typeof cap === 'number') return cap;
  if (typeof cap === 'object' && typeof cap.raw === 'number') return cap.raw;
  return Number(cap) || 0;
}

// Function to fetch and aggregate candles + run checks
async function processTicker(ticker) {
  try {
    // 1. Fetch 1h data
    const chart1h = await yahooFinance.chart(ticker, { interval: '1h', range: '3mo' });
    const quotes1h = chart1h.quotes || [];
    const valid1h = quotes1h.filter(q => q && q.open !== null && q.high !== null && q.low !== null && q.close !== null && q.volume !== null);

    // 2. Aggregate to 4h
    const valid4h = [];
    for (let i = 0; i < valid1h.length; i += 4) {
      if (i + 3 >= valid1h.length) break;
      const group = valid1h.slice(i, i + 4);
      const open = group[0].open;
      const close = group[3].close;
      const high = Math.max(...group.map(c => c.high));
      const low = Math.min(...group.map(c => c.low));
      const volume = group.reduce((sum, c) => sum + (c.volume || 0), 0);
      const date = group[3].date;
      valid4h.push({ date, open, high, low, close, volume });
    }

    const N = valid4h.length;
    if (N < 11) return null; // Not enough 4h candles

    const current = valid4h[N - 1];
    const prior10 = valid4h.slice(N - 11, N - 1);

    // Check 1: Consolidation
    const highs = prior10.map(c => Math.max(c.open, c.close));
    const lows = prior10.map(c => Math.min(c.open, c.close));
    const consolidationHigh = Math.max(...highs);
    const consolidationLow = Math.min(...lows);
    const rangePct = ((consolidationHigh - consolidationLow) / consolidationLow) * 100;
    if (rangePct > 12) return null;

    // Check 2: Breakout
    if (current.close < consolidationHigh * 1.02) return null;

    // Check 3: Breakout size
    const breakoutSize = (Math.abs(current.close - current.open) / current.open) * 100;
    if (breakoutSize < 5) return null;

    // Check 4: Relative volume
    const avgPriorVolume = prior10.reduce((sum, c) => sum + c.volume, 0) / 10;
    const relVolume = current.volume / avgPriorVolume;
    if (relVolume < 1.5) return null;

    // Fetch daily data for checks 5-8
    const dailyResult = await yahooFinance.chart(ticker, { interval: '1d', range: '6mo' });
    const dailyQuotes = (dailyResult.quotes || []).filter(q => q && q.open !== null && q.high !== null && q.low !== null && q.close !== null && q.volume !== null);
    if (dailyQuotes.length < 50) return null;

    // Check 5: Liquidity
    const last20Daily = dailyQuotes.slice(-20);
    const avgDailyVol = last20Daily.reduce((sum, q) => sum + q.volume, 0) / 20;
    if (avgDailyVol < 500000) return null;

    // Check 6: Market cap
    const summary = await yahooFinance.quoteSummary(ticker, { modules: ['summaryDetail'] });
    const marketCap = getMarketCap(summary);
    if (marketCap < 50000000) return null;

    // Daily Highs and SMAs
    const closes20 = dailyQuotes.slice(-20).map(q => q.close);
    const closes50 = dailyQuotes.slice(-50).map(q => q.close);

    const high20 = Math.max(...closes20);
    const high50 = Math.max(...closes50);

    // Check 7: Price level (within 10% of 20d or 50d high)
    const within20 = Math.abs(current.close - high20) / high20 * 100 <= 10;
    const within50 = Math.abs(current.close - high50) / high50 * 100 <= 10;
    if (!within20 && !within50) return null;

    // Check 8: Trend (above 20d and 50d SMA)
    const sma20 = closes20.reduce((sum, c) => sum + c, 0) / 20;
    const sma50 = closes50.reduce((sum, c) => sum + c, 0) / 50;
    if (current.close <= sma20 || current.close <= sma50) return null;

    // Percent from high computation (use the minimum gap to high as the stat)
    const pctFrom20h = ((high20 - current.close) / high20) * 100;
    const pctFrom50h = ((high50 - current.close) / high50) * 100;
    const pctFromHigh = Math.min(Math.abs(pctFrom20h), Math.abs(pctFrom50h));

    return {
      ticker,
      price: current.close,
      breakoutPct: ((current.close - consolidationHigh) / consolidationHigh) * 100,
      breakoutSize,
      relVolume,
      pctFromHigh,
      consolidationHigh,
      consolidationLow,
      candles: valid4h
    };
  } catch (error) {
    console.warn(`Error scanning ticker ${ticker}: ${error.message}`);
    return null;
  }
}

// POST /api/scan
app.post('/api/scan', async (req, res) => {
  const { market } = req.body;
  if (!market || (market !== 'india' && market !== 'usa')) {
    return res.status(400).json({ error: "Invalid market. Must be 'india' or 'usa'" });
  }

  console.log(`Starting scan for market: ${market}`);
  const tickers = market === 'india' ? IN_TICKERS : US_TICKERS;
  
  // Run scan in parallel batches of 5 to respect rate limits and perform well
  const flagged = await runBatches(tickers, 5, processTicker);

  // Sort descending by Relative Volume and limit to top 50
  const sorted = flagged
    .filter(Boolean)
    .sort((a, b) => b.relVolume - a.relVolume)
    .slice(0, 50);

  console.log(`Scan completed. Found ${sorted.length} breakout tickers.`);
  res.json(sorted);
});

// POST /api/chart
app.post('/api/chart', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  try {
    const chart1h = await yahooFinance.chart(ticker, { interval: '1h', range: '3mo' });
    const quotes1h = chart1h.quotes || [];
    const valid1h = quotes1h.filter(q => q && q.open !== null && q.high !== null && q.low !== null && q.close !== null && q.volume !== null);

    const valid4h = [];
    for (let i = 0; i < valid1h.length; i += 4) {
      if (i + 3 >= valid1h.length) break;
      const group = valid1h.slice(i, i + 4);
      const open = group[0].open;
      const close = group[3].close;
      const high = Math.max(...group.map(c => c.high));
      const low = Math.min(...group.map(c => c.low));
      const volume = group.reduce((sum, c) => sum + (c.volume || 0), 0);
      const date = group[3].date;
      valid4h.push({ date, open, high, low, close, volume });
    }

    const N = valid4h.length;
    if (N < 11) {
      return res.status(400).json({ error: "Not enough data for this ticker" });
    }

    const prior10 = valid4h.slice(N - 11, N - 1);
    const highs = prior10.map(c => Math.max(c.open, c.close));
    const lows = prior10.map(c => Math.min(c.open, c.close));
    const consolidationHigh = Math.max(...highs);
    const consolidationLow = Math.min(...lows);

    res.json({
      ticker,
      consolidationHigh,
      consolidationLow,
      candles: valid4h
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backtest
app.post('/api/backtest', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  try {
    // 1. Fetch 1h data and aggregate to 4h
    const chart1h = await yahooFinance.chart(ticker, { interval: '1h', range: '3mo' });
    const quotes1h = chart1h.quotes || [];
    const valid1h = quotes1h.filter(q => q && q.open !== null && q.high !== null && q.low !== null && q.close !== null && q.volume !== null);

    const valid4h = [];
    for (let i = 0; i < valid1h.length; i += 4) {
      if (i + 3 >= valid1h.length) break;
      const group = valid1h.slice(i, i + 4);
      const open = group[0].open;
      const close = group[3].close;
      const high = Math.max(...group.map(c => c.high));
      const low = Math.min(...group.map(c => c.low));
      const volume = group.reduce((sum, c) => sum + (c.volume || 0), 0);
      const date = group[3].date;
      valid4h.push({ date, open, high, low, close, volume });
    }

    if (valid4h.length < 11) {
      return res.status(400).json({ error: "Not enough data to run backtest" });
    }

    // 2. Spawn python subprocess for Nautilus Trader
    const pythonInterpreter = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
    const pythonScript = path.join(__dirname, 'nautilus_backtest.py');

    console.log(`Spawning Nautilus backtest subprocess for ${ticker}`);
    const py = spawn(pythonInterpreter, [pythonScript]);

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    py.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    py.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python script failed with code ${code}. Stderr: ${stderrData}`);
        return res.status(500).json({ error: "Nautilus Trader backtest process failed", details: stderrData });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        res.json(parsed);
      } catch (err) {
        console.error(`Failed to parse Python stdout: ${stdoutData}`);
        res.status(500).json({ error: "Failed to parse backtest results", details: stdoutData });
      }
    });

    // Write candles JSON to python stdin
    const payload = JSON.stringify({ ticker, candles: valid4h });
    py.stdin.write(payload);
    py.stdin.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
