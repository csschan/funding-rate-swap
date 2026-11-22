"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore, PerpPositionData } from "@/store/useAppStore";
import Link from "next/link";

const PLATFORM_COLORS: Record<string, string> = {
  Jupiter: "bg-purple-900/50 text-purple-300 border-purple-700/50",
  Pacifica: "bg-cyan-900/50 text-cyan-300 border-cyan-700/50",
};

function HedgeButton({ position }: { position: PerpPositionData }) {
  // Hedge logic: if you're Long on a perp, you pay funding when rate is positive.
  // To hedge, open a Fixed Payer swap → lock in fixed rate, receive floating.
  // If you're Short, you receive funding → open Floating Payer swap to lock it in.
  const hedgeDirection = position.side === "Long" ? "fixed" : "floating";
  const symbol = position.symbol.toLowerCase();

  return (
    <Link
      href={`/market/${symbol}?hedge=${hedgeDirection}&notional=${Math.round(position.sizeUsd)}&platform=${position.platform}`}
      className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition-colors whitespace-nowrap"
    >
      Hedge Funding
    </Link>
  );
}

export function PerpPositions() {
  const { publicKey } = useWallet();
  const { perpPositions, setPerpPositions } = useAppStore();

  useEffect(() => {
    if (!publicKey) {
      setPerpPositions([]);
      return;
    }
    async function load() {
      try {
        const res = await fetch(`/api/perp-positions?wallet=${publicKey!.toBase58()}`);
        if (res.ok) {
          const data = await res.json();
          setPerpPositions(data);
        }
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [publicKey, setPerpPositions]);

  if (!publicKey) return null;
  if (perpPositions.length === 0) return null;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase">Your Perp Positions</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-800/50">
          Funding Rate Risk
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        These positions are exposed to funding rate volatility. Hedge them with a funding rate swap to lock in a fixed cost.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
            <th className="text-left pb-3 font-medium">Platform</th>
            <th className="text-left pb-3 font-medium">Market</th>
            <th className="text-left pb-3 font-medium">Side</th>
            <th className="text-right pb-3 font-medium">Size</th>
            <th className="text-right pb-3 font-medium">Leverage</th>
            <th className="text-right pb-3 font-medium">Entry Price</th>
            <th className="pb-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {perpPositions.map((p, i) => {
            const color = PLATFORM_COLORS[p.platform] ?? "bg-gray-800 text-gray-400 border-gray-700";
            return (
              <tr key={`${p.platform}-${p.symbol}-${p.side}-${i}`} className="hover:bg-gray-900 transition-colors">
                <td className="py-3">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${color}`}>
                    {p.platform}
                  </span>
                </td>
                <td className="py-3 font-medium text-white">{p.symbol}-PERP</td>
                <td className="py-3">
                  <span className={p.side === "Long" ? "text-green-400" : "text-red-400"}>
                    {p.side}
                  </span>
                </td>
                <td className="py-3 text-right font-mono text-white">
                  ${p.sizeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="py-3 text-right font-mono text-gray-400">
                  {p.leverage}x
                </td>
                <td className="py-3 text-right font-mono text-gray-400">
                  ${p.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
                <td className="py-3 text-right">
                  <HedgeButton position={p} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
