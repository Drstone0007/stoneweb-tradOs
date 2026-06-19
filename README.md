# stoneweb · tradOs

> An aesthetic narrative for a pragmatic trader’s toolkit — where data, code, and intuition meet.

stoneweb/tradOs stitches together a lightweight breakout scanner, a Nautilus-based backtester, and a minimal backend that speaks to both. This repository is a workshop: part market screener, part experimental backtest harness, part developer playground.

---

## The story

Imagine a quiet observatory for price action — 4-hour candles as windows, ten bars of calm as the breath before a storm. The code here listens for that inhale and prepares for the exhale: breakouts that matter, born of volume, validated by trend and liquidity.

This README is less a manual and more a guided walk through the repository, its intent, and how to bring its pieces to life.

---

## What’s included

- server.js — Express backend powering the scanner, chart endpoints, and a bridge to Nautilus backtests (Node API).
- nautilus_backtest.py — Nautilus Trader backtest wrapper that reads 4-hour candles from stdin and runs a BreakoutStrategy.
- breakout-scanner/ — Frontend scaffold (Vite + React + Tailwind) for visualizing results and charts.
- test_skills.py — a small utility/test script (unrelated to market logic) used while developing local tool integrations.
- package.json / package-lock.json — Node deps and scripts.

---

## Design & approach

- Timeframe: 1-hour data aggregated to 4-hour bars — the repository treats 4-hour bars as the primary decision unit.
- Signal: consolidation of 10 prior 4-hour bars, breakout above the recent high with a minimum body size and elevated relative volume.
- Filters: liquidity (20-day average), market cap, proximity to recent 20/50-day highs, and being above 20/50 SMA — practical rules to reduce false positives.
- Engineering: rate-limited batch queries to Yahoo Finance (runBatches), careful data validation and graceful failure for missing data.

---

## Quick start

1. Clone the repo

   git clone https://github.com/Drstone0007/stoneweb-tradOs.git
   cd stoneweb-tradOs

2. Install Node dependencies (backend)

   npm install

3. Start the backend

   npm start

   - The server listens on http://localhost:3001

4. Frontend (optional)

   cd breakout-scanner
   npm install
   npm run dev

5. Nautilus backtests

   - This code expects a Python environment with nautilus_trader installed and a working .venv at the project root if you want to use the default server spawning path.
   - You can run the backtest directly by piping candles to nautilus_backtest.py or by using the backend POST /api/backtest endpoint which will spawn the Python process.

---

## API endpoints

- POST /api/scan
  - Payload: { "market": "usa" } or { "market": "india" }
  - Returns: array of flagged breakout objects (ticker, price, relVolume, breakoutSize, pctFromHigh, consolidationHigh/Low, candles...)

- POST /api/chart
  - Payload: { "ticker": "AAPL" }
  - Returns: consolidationHigh, consolidationLow, and candles (4h aggregation)

- POST /api/backtest
  - Payload: { "ticker": "AAPL" }
  - Behavior: server aggregates 1h -> 4h candles, then spawns the Nautilus python script (default python path: .venv/Scripts/python.exe) and streams candles via stdin. The python script returns a JSON summary of backtest results.

Notes:
- The backend uses yahoo-finance2 for OHLCV and quote summaries. Expect network latency and occasional symbol-specific missing data.
- The backtest runner assumes the nautilus_trader package API compatible with the included wrapper.

---

## Implementation highlights

- Aggregation: server.js builds 4-hour bars by grouping 1-hour quotes in fixed 4-bar windows.
- Robustness: the server filters out incomplete quotes and guards for insufficient history before signaling.
- Batch control: scan runs in batches of 5 tickers to reduce hitting rate limits.
- Backtest bridge: the Node server writes a JSON payload to Python stdin and parses stdout for structured results.

---

## Development notes

- If you don’t use Windows, or you prefer a different python interpreter, update the pythonInterpreter path in server.js (lines around spawn invocation) to point to your environment (e.g. `python3` or a venv bin path).
- Nautilus dependencies are heavyweight — consider running backtests locally inside a dedicated virtualenv.
- The frontend is a Vite React app with Tailwind; its package.json is under breakout-scanner/.

---

## Roadmap & ideas

- Add CI tests that mock yahoo-finance calls to validate screening logic without network.
- Make the Python backtest runner configurable (path, interpreter, timeout, memory limits).
- Export scan results to CSV/Google Sheets and add historical tracking.
- Add a lightweight job queue for scheduled scans and a minimal UI dashboard.

---

## Contributing

You — yes, you — are welcome. Open an issue or a PR. For larger changes, outline your idea first so we can align on design and test strategy.

---

## Attribution

Built with: Node.js, express, yahoo-finance2, Nautilus Trader (backtester), React + Vite + Tailwind (frontend scaffold).

---

If you’d like, I can commit this README to the repository for you (I can create README.md). Tell me whether to proceed and if you want any tone edits (more technical, more poetic, shorter, or including examples).