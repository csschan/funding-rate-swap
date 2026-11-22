"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ArbitrageData {
  symbol: string;
  jupiter: number | null;
  pacifica: number | null;
  spread: number | null;
  higher: string | null; // "Jupiter" | "Pacifica"
}

const PLATFORM_COLORS: Record<string, string> = {
  Jupiter: "text-purple-400",
  Pacifica: "text-cyan-400",
};

export function ArbitragePanel() {
  const [data, setData] = useState<ArbitrageData[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok) return;
        const json = await res.json();
        setData(json.arbitrage ?? []);
      } catch {
        // ignore
      }
    }
    load();
    // Refresh every 60s to get updated rates
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (data.length === 0) return null;

  const hasOpportunity = data.some((d) => d.spread && d.spread > 0.05);

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase">Cross-Platform Arbitrage</h2>
          {hasOpportunity && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-500">
          Live rates from Jupiter Perps (on-chain) and Pacifica (API)
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
            <th className="text-left pb-3 font-medium">Market</th>
            <th className="text-right pb-3 font-medium">
              <span className={PLATFORM_COLORS.Jupiter}>Jupiter</span> Borrow
            </th>
            <th className="text-right pb-3 font-medium">
              <span className={PLATFORM_COLORS.Pacifica}>Pacifica</span> Funding
            </th>
            <th className="text-right pb-3 font-medium">Spread</th>
            <th className="text-right pb-3 font-medium">Direction</th>
            <th className="text-right pb-3 font-medium">Est. Daily Yield</th>
            <th className="pb-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((d) => {
            const spread = d.spread ?? 0;
            const hasSpread = spread > 0.02;
            // Daily yield: spread(bps/h) × 24h × notional / 10,000
            const dailyYield = spread * 24 * 10000 / 10_000;
            const higher = d.higher;
            // Arbitrage direction explanation
            const dirLabel = higher === "Jupiter"
              ? "Short Jup + Long Pac"
              : higher === "Pacifica"
                ? "Short Pac + Long Jup"
                : "—";

            return (
              <tr key={d.symbol} className="hover:bg-gray-900 transition-colors">
                <td className="py-3 font-medium text-white">{d.symbol}-PERP</td>
                <td className="py-3 text-right">
                  <span className={`font-mono ${PLATFORM_COLORS.Jupiter}`}>
                    {d.jupiter != null ? `${d.jupiter.toFixed(4)} bps/h` : "—"}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className={`font-mono ${PLATFORM_COLORS.Pacifica}`}>
                    {d.pacifica != null ? `${d.pacifica.toFixed(4)} bps/h` : "—"}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className={`font-mono font-semibold ${
                    hasSpread ? "text-yellow-400" : "text-gray-500"
                  }`}>
                    {spread.toFixed(4)} bps
                  </span>
                </td>
                <td className="py-3 text-right">
                  <span className="text-xs text-gray-400">{dirLabel}</span>
                </td>
                <td className="py-3 text-right">
                  <span className="font-mono text-green-400 text-xs">
                    +${dailyYield.toFixed(2)}/day
                  </span>
                  <span className="text-gray-600 text-[10px] ml-1">per $10k</span>
                </td>
                <td className="py-3 text-right">
                  {hasSpread ? (
                    <Link
                      href={`/market/${d.symbol.toLowerCase()}?hedge=fixed&notional=10000&platform=Arbitrage:${higher}`}
                      className="px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      Capture Spread
                    </Link>
                  ) : (
                    <span className="text-gray-600 text-xs">Low spread</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 p-3 rounded-lg bg-gray-900/50 border border-gray-800">
        <p className="text-xs text-gray-400">
          <span className="font-medium">How it works: </span>
          Jupiter charges a <span className="text-purple-400">borrow fee</span> (based on JLP pool utilization)
          while Pacifica uses a traditional <span className="text-cyan-400">funding rate</span> (order-book premium).
          When these rates diverge, open a funding rate swap on FundingSwap to lock in the lower rate
          and profit from the spread. No need to manage positions on both platforms — the swap captures the difference.
        </p>
      </div>
    </div>
  );
}
