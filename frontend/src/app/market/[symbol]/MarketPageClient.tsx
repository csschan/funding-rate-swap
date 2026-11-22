"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { FundingRateChart } from "@/components/FundingRateChart";
import { OpenPositionForm } from "@/components/OpenPositionForm";
import { OrderBook } from "@/components/OrderBook";
import { generateMockHistory } from "@/lib/drift";
import { MARKETS, SWAP_MARKET_SEEDS } from "@/lib/constants";
import { deriveSwapMarket } from "@/lib/pda";
import { useAppStore } from "@/store/useAppStore";

export function MarketPageClient({ symbol }: { symbol: string }) {
  const liveRate = useAppStore((s) => s.liveRate);
  const searchParams = useSearchParams();

  const config = MARKETS.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());

  const [history, setHistory] = useState<{ date: string; rate: number }[]>([]);
  const [rateDir, setRateDir] = useState<"up" | "down" | "flat">("flat");
  const prevRateRef = useRef(liveRate);

  const currentRate = liveRate;
  const impliedRate = liveRate * 0.9;

  // Parse hedge params from URL (from PerpPositions "Hedge Funding" button)
  const hedgeDirection = searchParams.get("hedge"); // "fixed" | "floating"
  const hedgeNotional = searchParams.get("notional");
  const hedgePlatform = searchParams.get("platform");

  // Track direction change for color flash
  useEffect(() => {
    setRateDir(liveRate > prevRateRef.current ? "up" : liveRate < prevRateRef.current ? "down" : "flat");
    prevRateRef.current = liveRate;
  }, [liveRate]);

  // Generate mock history from backend API
  useEffect(() => {
    if (!config) return;
    async function seedHistory() {
      try {
        const res = await fetch("/api/markets");
        const data = res.ok ? await res.json() : [];
        const market = data.find((m: any) => m.symbol === config!.symbol);
        setHistory(generateMockHistory(market?.fundingRate ?? 50));
      } catch {
        setHistory(generateMockHistory(50));
      }
    }
    seedHistory();
  }, [config]);

  if (!config) {
    return <div className="text-center py-16 text-gray-500">Market not found</div>;
  }

  const seed = SWAP_MARKET_SEEDS[config.symbol];
  const swapMarketPda = seed ? deriveSwapMarket(seed) : deriveSwapMarket(SWAP_MARKET_SEEDS.SOL);

  // Token accent colors per symbol
  const tokenColor: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    SOL: { bg: "bg-purple-900/30", text: "text-purple-300", border: "border-purple-700/50", dot: "bg-purple-400" },
    ETH: { bg: "bg-blue-900/30", text: "text-blue-300", border: "border-blue-700/50", dot: "bg-blue-400" },
    BTC: { bg: "bg-orange-900/30", text: "text-orange-300", border: "border-orange-700/50", dot: "bg-orange-400" },
  };
  const accent = tokenColor[config.symbol] ?? { bg: "bg-gray-800", text: "text-gray-300", border: "border-gray-600", dot: "bg-gray-400" };

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <a href="/" className="hover:text-gray-300 transition-colors">Markets</a>
        <span>/</span>
        <span className="text-gray-300">{config.name}</span>
      </div>

      {/* Hedge banner — shown when navigated from "Hedge Funding" button */}
      {hedgeDirection && hedgePlatform && (
        <div className="mb-6 p-4 rounded-xl border border-green-800/50 bg-green-900/20">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-400 text-sm font-semibold">Hedge Mode</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-300 border-gray-700">
              {hedgePlatform}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            Auto-filled from your {hedgePlatform} {symbol.toUpperCase()}-PERP position.
            {hedgeDirection === "fixed"
              ? " You're Long on perps → pay fixed rate to hedge your funding cost."
              : " You're Short on perps → pay floating to lock in your funding income."}
            {hedgeNotional && ` Notional: $${Number(hedgeNotional).toLocaleString()}`}
          </p>
        </div>
      )}

      {/* Market header */}
      <div className="mb-6 flex items-center gap-4">
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${accent.bg} border ${accent.border}`}>
          <span className={`text-lg font-bold ${accent.text}`}>{config.symbol}</span>
        </div>

        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">{config.name}</h1>
            {config.comingSoon ? (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-900/40 text-yellow-500 border border-yellow-800/50">
                Coming Soon
              </span>
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded ${accent.bg} ${accent.text} border ${accent.border}`}>
                Live on Devnet
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-gray-400 text-sm">Funding Rate Swap Market</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-800 text-gray-300 border-gray-700">
              via {config.fundingSource} · {config.fundingInterval}
            </span>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Current Funding Rate
          </div>
          <div className={`text-lg font-bold font-mono transition-colors duration-300 ${
            rateDir === "up" ? "text-green-400" : rateDir === "down" ? "text-red-400" : "text-white"
          }`}>
            {currentRate.toFixed(2)} bps/{config.fundingInterval}
            <span className="ml-1 text-sm">{rateDir === "up" ? "▲" : rateDir === "down" ? "▼" : ""}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{(currentRate * 3 * 365 / 100).toFixed(1)}% APR · {config.fundingSource}</div>
        </div>

        {[
          { label: "Implied Fixed Rate", value: `${impliedRate.toFixed(2)} bps`, sub: "Market consensus" },
          { label: "Spread", value: `${(currentRate - impliedRate).toFixed(2)} bps`, sub: currentRate > impliedRate ? "Hedge opportunity" : "Yield opportunity" },
          { label: "Open Interest", value: "$0", sub: "Devnet" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-bold text-white mt-1 font-mono">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* Chart + Order Form */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="col-span-2 bg-gray-950 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase mb-4">
            30-Day Funding Rate History
          </h2>
          <FundingRateChart data={history} impliedFixedRate={impliedRate} />
          <p className="text-xs text-gray-600 mt-2">
            Green line = actual funding rate · Dashed line = current implied fixed rate
          </p>
        </div>

        <div className="bg-gray-950 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase mb-4">
            {hedgeDirection ? "Hedge Position" : "Open Position"}
          </h2>
          {config.comingSoon ? (
            <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
              <span className="text-gray-500 text-sm">
                Swap market for {config.name} is not yet initialized on devnet.
              </span>
              <span className="text-xs text-gray-600">
                Only funding rate data is available. Trading coming soon.
              </span>
            </div>
          ) : (
            <OpenPositionForm
              currentRate={currentRate}
              impliedFixedRate={impliedRate}
              hedgeDirection={hedgeDirection as "fixed" | "floating" | null}
              hedgeNotional={hedgeNotional ? Number(hedgeNotional) : undefined}
            />
          )}
        </div>
      </div>

      {/* Order Book — full width */}
      <OrderBook marketPubkey={swapMarketPda} />
    </main>
  );
}
