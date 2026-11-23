"use client";

import { useEffect } from "react";
import { MarketTable } from "@/components/MarketTable";
import { PerpPositions } from "@/components/PerpPositions";
import { ArbitragePanel } from "@/components/ArbitragePanel";
import { useAppStore } from "@/store/useAppStore";
import { MARKETS, SWAP_MARKET_SEEDS } from "@/lib/constants";
import { deriveSwapMarket } from "@/lib/pda";

export default function HomePage() {
  const { markets, setMarkets, isLoading, setLoading, liveRate } = useAppStore();

  // Sync live rate into markets data so MarketTable re-renders every tick
  useEffect(() => {
    if (markets.length === 0 || liveRate === 0) return;
    setMarkets(markets.map((m, i) => {
      const offset = i === 0 ? 0 : i === 1 ? -3 : 5;
      const rate = Math.max(1, liveRate + offset);
      return { ...m, currentFundingRate: rate, impliedFixedRate: rate * 0.9 };
    }));
  }, [liveRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load markets once via backend API
  useEffect(() => {
    async function loadMarkets() {
      setLoading(true);
      try {
        const res = await fetch("/api/markets");
        const json = res.ok ? await res.json() : { markets: [], arbitrage: [] };
        // Handle both old format (array) and new format ({markets, arbitrage})
        const data = Array.isArray(json) ? json : (json.markets ?? []);
        const loaded = MARKETS.map((m, i) => {
          const seed = SWAP_MARKET_SEEDS[m.symbol];
          const swapMarket = seed ? deriveSwapMarket(seed) : deriveSwapMarket(SWAP_MARKET_SEEDS.SOL);
          const rate = data[i]?.fundingRate ?? 50;
          return {
            name: m.name,
            symbol: m.symbol,
            currentFundingRate: rate,
            impliedFixedRate: rate * 0.9,
            volume24h: 0,
            swapMarket: swapMarket.toBase58(),
            fundingSource: data[i]?.fundingSource ?? m.fundingSource,
            fundingInterval: data[i]?.fundingInterval ?? m.fundingInterval,
          };
        });
        setMarkets(loaded);
      } finally {
        setLoading(false);
      }
    }
    loadMarkets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Funding Rate Swap</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Hedge or speculate on perpetual contract funding rates. Pay fixed, receive floating — or vice versa.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Volume", value: "$0" },
          { label: "Active Positions", value: "0" },
          { label: "Network", value: "Devnet" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-bold text-white mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-400 uppercase mb-4">Markets</h2>
        {isLoading && markets.length === 0 ? (
          <div className="text-center py-16 text-gray-500">Loading...</div>
        ) : (
          <MarketTable markets={markets} />
        )}
      </div>

      {/* Cross-platform arbitrage opportunities */}
      <ArbitragePanel />

      {/* Show user's existing perp positions with hedge buttons */}
      <PerpPositions />
    </main>
  );
}
