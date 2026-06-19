import React, { useState, useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

// Candlestick Chart Component utilizing lightweight-charts
function CandlestickChart({ data, consolidationHigh, consolidationLow }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0 || !chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: '#1e293b' }, // slate-800
        textColor: '#cbd5e1', // slate-300
      },
      grid: {
        vertLines: { color: '#334155' }, // slate-700
        horzLines: { color: '#334155' },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      width: chartContainerRef.current.clientWidth,
      height: 350,
    });

    chartRef.current = chart;

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981', // emerald-500
      downColor: '#ef4444', // red-500
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    seriesRef.current = candlestickSeries;

    // Format data: YYYY-MM-DD string as time
    const formattedData = data.map((c, index) => {
      const isBreakout = index === data.length - 1;
      const dateObj = new Date(c.date);
      // Format as YYYY-MM-DD or use UTC timestamp
      const timeVal = dateObj.toISOString().split('T')[0];
      return {
        time: timeVal,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        // Override color for breakout candle
        color: isBreakout ? '#10b981' : undefined,
        wickColor: isBreakout ? '#10b981' : undefined,
      };
    });

    candlestickSeries.setData(formattedData);

    // Draw rose-500 price lines for consolidation range
    const highLine = candlestickSeries.createPriceLine({
      price: parseFloat(consolidationHigh),
      color: '#f43f5e', // rose-500
      lineWidth: 2,
      lineStyle: 1, // solid
      axisLabelVisible: true,
      title: 'Consolidation High',
    });

    const lowLine = candlestickSeries.createPriceLine({
      price: parseFloat(consolidationLow),
      color: '#f43f5e',
      lineWidth: 2,
      lineStyle: 1,
      axisLabelVisible: true,
      title: 'Consolidation Low',
    });

    // Fit content
    chart.timeScale().fitContent();

    // Handle resizing
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, consolidationHigh, consolidationLow]);

  return (
    <div className="relative w-full">
      <div ref={chartContainerRef} className="w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-700" />
      {/* Visual Indicator of the overlay range */}
      <div className="absolute top-2 left-2 bg-rose-500/10 border border-rose-500/30 px-3 py-1 rounded text-xs text-rose-300">
        Consolidation Range: {parseFloat(consolidationLow).toFixed(2)} - {parseFloat(consolidationHigh).toFixed(2)} (Rose Lines)
      </div>
    </div>
  );
}

export default function App() {
  const [market, setMarket] = useState('india'); // 'india' | 'usa'
  const [flaggedStocks, setFlaggedStocks] = useState([]);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [selectedStockData, setSelectedStockData] = useState(null);
  const [loadingScan, setLoadingScan] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [backtestResult, setBacktestResult] = useState(null);
  const [lastScanned, setLastScanned] = useState(null);
  const [activeTab, setActiveTab] = useState('screener'); // 'screener' | 'backtest'

  // Load cache from localstorage if exists
  useEffect(() => {
    const cachedIndia = localStorage.getItem('breakout_screener_india');
    const cachedUsa = localStorage.getItem('breakout_screener_usa');
    const tsIndia = localStorage.getItem('breakout_screener_india_ts');
    const tsUsa = localStorage.getItem('breakout_screener_usa_ts');

    if (market === 'india' && cachedIndia) {
      setFlaggedStocks(JSON.parse(cachedIndia));
      setLastScanned(tsIndia);
    } else if (market === 'usa' && cachedUsa) {
      setFlaggedStocks(JSON.parse(cachedUsa));
      setLastScanned(tsUsa);
    } else {
      setFlaggedStocks([]);
      setLastScanned(null);
    }
    setSelectedTicker('');
    setSelectedStockData(null);
    setBacktestResult(null);
  }, [market]);

  // Handle Scan Now triggering
  const handleScan = async () => {
    setLoadingScan(true);
    setFlaggedStocks([]);
    setSelectedTicker('');
    setSelectedStockData(null);
    setBacktestResult(null);
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market })
      });
      const data = await response.json();
      if (Array.isArray(data)) {
        setFlaggedStocks(data);
        const timestamp = new Date().toLocaleTimeString();
        setLastScanned(timestamp);
        localStorage.setItem(`breakout_screener_${market}`, JSON.stringify(data));
        localStorage.setItem(`breakout_screener_${market}_ts`, timestamp);

        if (data.length > 0) {
          // Select first stock automatically
          setSelectedTicker(data[0].ticker);
          setSelectedStockData(data[0]);
        }
      }
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setLoadingScan(false);
    }
  };

  // Fetch chart data if not already cached
  const handleTickerChange = async (ticker) => {
    if (!ticker) return;
    setSelectedTicker(ticker);
    setBacktestResult(null);

    // If stock already exists in scan results, use its preloaded candles
    const preloaded = flaggedStocks.find(s => s.ticker === ticker);
    if (preloaded && preloaded.candles) {
      setSelectedStockData(preloaded);
      return;
    }

    setLoadingChart(true);
    try {
      const response = await fetch('/api/chart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker })
      });
      const data = await response.json();
      setSelectedStockData(data);
    } catch (error) {
      console.error("Failed to load chart:", error);
    } finally {
      setLoadingChart(false);
    }
  };

  // Execute backtest using Nautilus Trader subprocess
  const handleRunBacktest = async () => {
    if (!selectedTicker) return;
    setLoadingBacktest(true);
    setBacktestResult(null);
    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker })
      });
      const data = await response.json();
      setBacktestResult(data);
    } catch (error) {
      console.error("Backtest failed:", error);
      alert("Nautilus Trader backtest failed. Verify the Python backend state.");
    } finally {
      setLoadingBacktest(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col justify-between">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/80 backdrop-blur sticky top-0 z-50 px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500 text-slate-900 font-black p-2 rounded-xl text-xl shadow-lg shadow-emerald-500/25">
              🚀
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Breakout Scanner</h1>
              <p className="text-xs text-slate-400">Powered by Nautilus Trader & Yahoo Finance</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {lastScanned && (
              <span className="text-xs bg-slate-700 px-3 py-1.5 rounded-full text-slate-300">
                Last Scanned: <span className="font-semibold text-emerald-400">{lastScanned}</span>
              </span>
            )}
            <button
              onClick={handleScan}
              disabled={loadingScan}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-900 font-bold px-6 py-2.5 rounded-full hover:opacity-90 transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loadingScan ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-slate-900" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <span>Scan Now</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-grow w-full grid grid-cols-1 gap-8">
        
        {/* Navigation & Markets */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 shadow-inner">
            <button
              onClick={() => setMarket('india')}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${
                market === 'india'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              India 🇮🇳
            </button>
            <button
              onClick={() => setMarket('usa')}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${
                market === 'usa'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              USA 🇺🇸
            </button>
          </div>

          {/* Screener / Backtest tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('screener')}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                activeTab === 'screener'
                  ? 'bg-slate-700 text-emerald-400 border-emerald-500/30'
                  : 'bg-transparent text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              📊 Breakout Screener
            </button>
            <button
              onClick={() => setActiveTab('backtest')}
              className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                activeTab === 'backtest'
                  ? 'bg-slate-700 text-emerald-400 border-emerald-500/30'
                  : 'bg-transparent text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              🤖 Nautilus Backtester
            </button>
          </div>
        </div>

        {/* Tab 1: Breakout Screener Table */}
        {activeTab === 'screener' && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white">Screener Results ({flaggedStocks.length})</h2>
              <span className="text-xs text-slate-400">Sorted by Relative Volume</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/50 text-slate-400 text-xs tracking-wider uppercase">
                    <th className="py-4 px-6">Ticker</th>
                    <th className="py-4 px-6 text-right">Price</th>
                    <th className="py-4 px-6 text-right">Breakout %</th>
                    <th className="py-4 px-6 text-right">Breakout Size %</th>
                    <th className="py-4 px-6 text-right">Relative Volume</th>
                    <th className="py-4 px-6 text-right">% from 20d/50d High</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedStocks.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-12 text-center text-slate-500">
                        {loadingScan ? 'Scanning markets for breakout setups...' : 'No breakouts found — try scanning again.'}
                      </td>
                    </tr>
                  ) : (
                    flaggedStocks.map((stock) => (
                      <tr
                        key={stock.ticker}
                        onClick={() => handleTickerChange(stock.ticker)}
                        className={`border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors ${
                          selectedTicker === stock.ticker ? 'bg-emerald-500/5 text-emerald-300 border-l-4 border-l-emerald-500' : ''
                        }`}
                      >
                        <td className="py-4 px-6 font-bold">{stock.ticker}</td>
                        <td className="py-4 px-6 text-right font-mono">{stock.price.toFixed(2)}</td>
                        <td className="py-4 px-6 text-right font-mono text-emerald-400">+{stock.breakoutPct.toFixed(2)}%</td>
                        <td className="py-4 px-6 text-right font-mono">{stock.breakoutSize.toFixed(2)}%</td>
                        <td className="py-4 px-6 text-right font-mono font-semibold text-teal-400">{stock.relVolume.toFixed(2)}x</td>
                        <td className="py-4 px-6 text-right font-mono">{stock.pctFromHigh.toFixed(2)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Nautilus Backtester */}
        {activeTab === 'backtest' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Backtest Control Panel */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 shadow-xl flex flex-col justify-between h-full min-h-[300px]">
              <div>
                <h3 className="text-lg font-bold text-white mb-4">Nautilus Config</h3>
                <div className="mb-4">
                  <label className="text-xs text-slate-400 block mb-1">Target Ticker</label>
                  <select
                    value={selectedTicker}
                    onChange={(e) => handleTickerChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-200 px-3 py-2.5 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select Ticker --</option>
                    {flaggedStocks.map(s => (
                      <option key={s.ticker} value={s.ticker}>{s.ticker}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-slate-400 leading-relaxed bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 mb-6">
                  <span className="font-bold text-emerald-400 block mb-1">Strategy parameters:</span>
                  - Starts with $1,000,000 USD/INR initial balance.<br/>
                  - Standard netting OMS execution model.<br/>
                  - Buys 100 shares at consolidation breakout close.<br/>
                  - Exits position when price falls back below the consolidation range low.
                </div>
              </div>

              <button
                onClick={handleRunBacktest}
                disabled={loadingBacktest || !selectedTicker}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-900 font-bold py-3 rounded-xl transition-all shadow-lg hover:opacity-90 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
              >
                {loadingBacktest ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-slate-900" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Running Nautilus backtest...</span>
                  </>
                ) : (
                  <span>Run Backtest</span>
                )}
              </button>
            </div>

            {/* Backtest Reports */}
            <div className="lg:col-span-2 bg-slate-800 rounded-2xl border border-slate-700 p-6 shadow-xl flex flex-col min-h-[300px]">
              <h3 className="text-lg font-bold text-white mb-4">Backtest Ledger Report</h3>

              {!backtestResult ? (
                <div className="flex-grow flex flex-col justify-center items-center text-slate-500 text-sm py-12">
                  <span>No backtest runs recorded yet.</span>
                  <span className="text-xs text-slate-600 mt-1">Select a breakout stock ticker and run a simulated trade.</span>
                </div>
              ) : (
                <div className="flex-grow flex flex-col gap-6">
                  {/* Account Summary Stats */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-700/50">
                      <span className="text-xs text-slate-400 block mb-1">Starting Balance</span>
                      <span className="text-lg font-bold text-white font-mono">
                        {backtestResult.initial_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} {backtestResult.currency}
                      </span>
                    </div>
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-700/50">
                      <span className="text-xs text-slate-400 block mb-1">Ending Balance</span>
                      <span className="text-lg font-bold text-white font-mono">
                        {backtestResult.final_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} {backtestResult.currency}
                      </span>
                    </div>
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-700/50">
                      <span className="text-xs text-slate-400 block mb-1">Total P&L</span>
                      <span className={`text-lg font-bold font-mono ${backtestResult.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {backtestResult.pnl >= 0 ? '+' : ''}
                        {backtestResult.pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })} {backtestResult.currency}
                      </span>
                    </div>
                  </div>

                  {/* Fills table */}
                  <div className="flex-grow">
                    <h4 className="text-xs text-slate-400 font-bold mb-2 uppercase tracking-wide">Execution Ledger</h4>
                    <div className="max-h-[200px] overflow-y-auto rounded-lg border border-slate-700/50">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900 border-b border-slate-700 text-slate-400">
                            <th className="py-2 px-4">Time</th>
                            <th className="py-2 px-4">Instrument</th>
                            <th className="py-2 px-4">Side</th>
                            <th className="py-2 px-4 text-right">Price</th>
                            <th className="py-2 px-4 text-right">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtestResult.fills.length === 0 ? (
                            <tr>
                              <td colSpan="5" className="py-8 text-center text-slate-500">
                                No order executions generated. Setup did not trigger a breakout.
                              </td>
                            </tr>
                          ) : (
                            backtestResult.fills.map((fill, index) => (
                              <tr key={index} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                                <td className="py-2.5 px-4 font-mono text-slate-400">{fill.ts_init || fill.timestamp}</td>
                                <td className="py-2.5 px-4 font-semibold">{fill.instrument_id || selectedTicker}</td>
                                <td className="py-2.5 px-4">
                                  <span className={`px-2 py-0.5 rounded font-bold ${
                                    fill.side === 'BUY' || fill.side === 1 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                  }`}>
                                    {fill.side === 1 || fill.side === 'BUY' ? 'BUY' : 'SELL'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-right font-mono">{(fill.price).toFixed(2)}</td>
                                <td className="py-2.5 px-4 text-right font-mono">{fill.quantity || fill.qty}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chart Panel */}
        {selectedStockData && (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 shadow-xl grid grid-cols-1 gap-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>Candlestick Chart:</span>
                  <span className="text-emerald-400 font-extrabold">{selectedTicker}</span>
                </h3>
                <p className="text-xs text-slate-400">Showing completed 4-hour candles from lookback window</p>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400">Select Ticker:</label>
                <select
                  value={selectedTicker}
                  onChange={(e) => handleTickerChange(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Select --</option>
                  {flaggedStocks.map(s => (
                    <option key={s.ticker} value={s.ticker}>{s.ticker}</option>
                  ))}
                </select>
              </div>
            </div>

            {loadingChart ? (
              <div className="w-full h-[350px] bg-slate-900 rounded-xl border border-slate-700/50 flex flex-col justify-center items-center text-slate-500">
                <svg className="animate-spin h-8 w-8 text-emerald-500 mb-2" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Loading Chart Data...</span>
              </div>
            ) : (
              <CandlestickChart
                data={selectedStockData.candles}
                consolidationHigh={selectedStockData.consolidationHigh}
                consolidationLow={selectedStockData.consolidationLow}
              />
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-955 py-6 px-6 text-center text-xs text-slate-500">
        <p className="max-w-2xl mx-auto">
          For educational and research purposes only. Not financial advice. Past performance of breakout signals backtested via Nautilus Trader is no guarantee of future results.
        </p>
      </footer>
    </div>
  );
}
