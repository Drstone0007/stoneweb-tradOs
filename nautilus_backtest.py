import sys
import json
import pandas as pd
from decimal import Decimal
import datetime as dt

from nautilus_trader.backtest.engine import BacktestEngine
from nautilus_trader.config import BacktestEngineConfig, LoggingConfig
from nautilus_trader.model import TraderId
from nautilus_trader.model.currencies import USD, Currency
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import AccountType, OmsType, OrderSide
from nautilus_trader.model.identifiers import Venue, Symbol, InstrumentId
from nautilus_trader.model.objects import Money, Price, Quantity
from nautilus_trader.persistence.wranglers import BarDataWrangler
from nautilus_trader.test_kit.providers import TestInstrumentProvider
from nautilus_trader.trading.strategy import Strategy

class BreakoutStrategy(Strategy):
    def __init__(self, primary_bar_type, trade_size=100):
        super().__init__()
        self.primary_bar_type = primary_bar_type
        self.trade_size = Decimal(trade_size)
        self.bars = []

    def on_start(self):
        self.subscribe_bars(self.primary_bar_type)

    def on_bar(self, bar: Bar):
        self.bars.append(bar)
        if len(self.bars) < 11:
            return

        current = bar
        prior_bars = self.bars[-11:-1]
        
        # Calculate consolidation range
        highs = [max(float(b.open), float(b.close)) for b in prior_bars]
        lows = [min(float(b.open), float(b.close)) for b in prior_bars]
        
        consolidation_high = max(highs)
        consolidation_low = min(lows)
        range_pct = (consolidation_high - consolidation_low) / consolidation_low * 100
        
        curr_close = float(current.close)
        curr_open = float(current.open)
        curr_vol = float(current.volume)
        
        # Relative Volume
        avg_vol = sum([float(b.volume) for b in prior_bars]) / len(prior_bars)
        rel_vol = curr_vol / avg_vol if avg_vol > 0 else 0
        
        # Breakout checks
        breakout_size = abs(curr_close - curr_open) / curr_open * 100
        
        # Check current position
        position = self.portfolio.position(bar.instrument_id)
        is_flat = position is None or position.is_flat
        
        if is_flat:
            # Check breakout entry conditions
            if range_pct <= 12.0 and curr_close >= consolidation_high * 1.02 and breakout_size >= 5.0 and rel_vol >= 1.5:
                order = self.order_factory.market(
                    instrument_id=bar.instrument_id,
                    side=OrderSide.BUY,
                    quantity=Quantity.from_decimal(self.trade_size)
                )
                self.submit_order(order)
                self.log.info(f"BUY order submitted at close {curr_close}")
        else:
            # Exit when close drops below consolidation low
            if curr_close <= consolidation_low:
                order = self.order_factory.market(
                    instrument_id=bar.instrument_id,
                    side=OrderSide.SELL,
                    quantity=Quantity.from_decimal(self.trade_size)
                )
                self.submit_order(order)
                self.log.info(f"SELL exit order submitted at close {curr_close}")

def main():
    # Read candles from stdin
    try:
        input_text = sys.stdin.read()
        input_data = json.loads(input_text)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse stdin: {str(e)}"}))
        return

    ticker = input_data.get("ticker", "AAPL")
    candles = input_data.get("candles", [])

    if not candles:
        print(json.dumps({"error": "No candles data provided"}))
        return

    # Setup BacktestEngine
    engine_config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
        logging=LoggingConfig(log_level="ERROR") # suppress logs
    )
    engine = BacktestEngine(config=engine_config)

    # Determine venue and currency
    is_india = ticker.endswith(".NS")
    venue_name = "NSE" if is_india else "XNAS"
    currency = "INR" if is_india else "USD"
    
    VENUE = Venue(venue_name)
    BASE_CURRENCY = Currency(currency)
    
    engine.add_venue(
        venue=VENUE,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=BASE_CURRENCY,
        starting_balances=[Money(1000000.0, BASE_CURRENCY)]
    )

    # Add mock instrument
    symbol_str = ticker.split(".")[0]
    instrument = TestInstrumentProvider.equity(symbol=symbol_str, venue=venue_name)
    engine.add_instrument(instrument)

    # Prepare DataFrame
    df = pd.DataFrame(candles)
    df['timestamp'] = pd.to_datetime(df['date'])
    df = df.sort_values('timestamp')
    df['open'] = df['open'].astype(float)
    df['high'] = df['high'].astype(float)
    df['low'] = df['low'].astype(float)
    df['close'] = df['close'].astype(float)
    df['volume'] = df['volume'].astype(int)
    df = df.set_index('timestamp')
    
    # Define bar type
    bar_type = BarType.from_str(f"{instrument.id}-4-HOUR-LAST-EXTERNAL")
    
    # Process bars and load to engine
    wrangler = BarDataWrangler(bar_type, instrument)
    bars = wrangler.process(df)
    engine.add_data(bars)

    # Add strategy
    strategy = BreakoutStrategy(primary_bar_type=bar_type, trade_size=100)
    engine.add_strategy(strategy)

    # Execute backtest
    engine.run()

    # Retrieve final account details
    acct = engine.trader.portfolio.account(VENUE)
    initial_balance = 1000000.0
    final_balance = float(acct.balance.amount)
    pnl = final_balance - initial_balance

    # Get order fills report
    fills_df = engine.trader.generate_order_fills_report()
    fills_data = []
    
    if not fills_df.empty:
        fills_df = fills_df.copy()
        # Ensure column names are standardized
        # Typical columns: 'ts_init' or 'timestamp', 'price', 'quantity', 'side', 'instrument_id'
        for col in fills_df.columns:
            if pd.api.types.is_datetime64_any_dtype(fills_df[col]):
                fills_df[col] = fills_df[col].astype(str)
            else:
                fills_df[col] = fills_df[col].apply(lambda x: float(x) if isinstance(x, Decimal) else x)
        fills_data = fills_df.to_dict(orient='records')

    result = {
        "ticker": ticker,
        "initial_balance": initial_balance,
        "final_balance": final_balance,
        "pnl": pnl,
        "currency": currency,
        "total_fills": len(fills_data),
        "fills": fills_data
    }
    
    # Print the JSON output
    print(json.dumps(result))
    
    engine.dispose()

if __name__ == "__main__":
    main()
