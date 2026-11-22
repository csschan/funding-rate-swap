"use client";

import Link from "next/link";
import { useRef, useEffect, useState } from "react";
import { MarketData } from "@/store/useAppStore";

interface Props {
  markets: MarketData[];
}

const SOURCE_COLORS: Record<string, string> = {
  Drift: "bg-purple-900/50 text-purple-300 border-purple-700/50",
  Jupiter: "bg-green-900/50 text-green-300 border-green-700/50",
  Binance: "bg-yellow-900/50 text-yellow-300 border-yellow-700/50",
};

function SourceBadge({ source, interval }: { source: string; interval: string }) {
  const color = SOURCE_COLORS[source] ?? "bg-gray-800 text-gray-400 border-gray-700";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${color}`}>
      {source} · {interval}
    </span>
  );
}

function RateCell({ rate }: { rate: number }) {
  const prevRef = useRef(rate);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (rate !== prevRef.current) {
      setFlash(rate > prevRef.current ? "up" : "down");
      prevRef.current = rate;
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [rate]);

  return (
    <div className="flex flex-col items-end">
      <span className={`font-mono font-semibold transition-colors duration-300 ${
        flash === "up" ? "text-green-300" : flash === "down" ? "text-red-300" : "text-green-400"
      }`}>
        {rate.toFixed(2)} bps
        <span className="ml-1 text-xs">{flash === "up" ? "▲" : flash === "down" ? "▼" : ""}</span>
      </span>
      <span className="text-xs text-gray-500">{(rate * 3 * 365 / 100).toFixed(1)}% APR</span>
    </div>
  );
}

export function MarketTable({ markets }: Props) {
  if (markets.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        Loading markets...
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
          <th className="text-left pb-3 font-medium">Market</th>
          <th className="text-right pb-3 font-medium">Current Rate</th>
          <th className="text-right pb-3 font-medium">Implied Fixed</th>
          <th className="text-right pb-3 font-medium">Spread</th>
          <th className="text-right pb-3 font-medium">24h Volume</th>
          <th className="pb-3" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800">
        {markets.map((m) => {
          const spread = m.currentFundingRate - m.impliedFixedRate;
          return (
            <tr key={m.swapMarket} className="hover:bg-gray-900 transition-colors">
              <td className="py-4">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-white">{m.name}</span>
                  <SourceBadge source={m.fundingSource} interval={m.fundingInterval} />
                </div>
              </td>
              <td className="py-4 text-right">
                <RateCell rate={m.currentFundingRate} />
              </td>
              <td className="py-4 text-right">
                <span className="font-mono text-indigo-400">{m.impliedFixedRate.toFixed(2)} bps</span>
              </td>
              <td className="py-4 text-right">
                <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                  spread > 0 ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                }`}>
                  {spread > 0 ? "+" : ""}{spread.toFixed(2)}
                </span>
              </td>
              <td className="py-4 text-right text-gray-400">
                ${(m.volume24h / 1_000_000).toFixed(0)}K
              </td>
              <td className="py-4 text-right">
                <Link
                  href={`/market/${m.symbol.toLowerCase()}`}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                >
                  Trade
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
