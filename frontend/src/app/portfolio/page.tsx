"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { PositionCard } from "@/components/PositionCard";
import { useAppStore } from "@/store/useAppStore";
import { fetchMyPositions, fetchMyOrders } from "@/lib/fetchPortfolio";
import { buildCancelOrderTx } from "@/lib/program";

type Tab = "positions" | "orders";

function formatTimeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)      return `${diff}s ago`;
  if (diff < 3600)    return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)   return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PortfolioPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { myPositions, myOrders, setMyPositions, setMyOrders } = useAppStore();

  const [activeTab, setActiveTab] = useState<Tab>("positions");
  const [loading, setLoading] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadPortfolio = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      // Positions via backend API (avoids client-side 429 rate limits)
      const posRes = await fetch(`/api/positions?wallet=${publicKey.toBase58()}`);
      const positions = posRes.ok ? await posRes.json() : [];

      // Orders still via direct RPC (lighter query)
      const orders = await fetchMyOrders(connection, publicKey);

      setMyPositions(positions);
      setMyOrders(orders);
    } catch (err) {
      console.error("Failed to load portfolio:", err);
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection, setMyPositions, setMyOrders]);

  useEffect(() => {
    loadPortfolio();
    const interval = setInterval(loadPortfolio, 60_000);
    return () => clearInterval(interval);
  }, [loadPortfolio]);

  async function handleCancelOrder(orderPubkey: string) {
    if (!publicKey) return;
    setCancellingOrder(orderPubkey);
    setCancelError(null);
    try {
      const tx = await buildCancelOrderTx(connection, publicKey, new PublicKey(orderPubkey));
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      await loadPortfolio();
    } catch (err: any) {
      console.error("Cancel order failed:", err);
      setCancelError(err?.message ?? "Cancel failed");
    } finally {
      setCancellingOrder(null);
    }
  }

  if (!publicKey) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-24 text-center">
        <div className="inline-flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-gray-300 font-medium">Connect your wallet to view your portfolio</p>
          <p className="text-gray-600 text-sm">Your positions and open orders will appear here.</p>
        </div>
      </main>
    );
  }

  const activePositions = myPositions.filter((p) => p.isActive);
  const closedPositions = myPositions.filter((p) => !p.isActive);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Portfolio</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-4)}
          </p>
        </div>
        <button
          onClick={loadPortfolio}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs mb-1">Active Positions</div>
          <div className="text-2xl font-bold text-white">{activePositions.length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs mb-1">Open Orders</div>
          <div className="text-2xl font-bold text-white">{myOrders.length}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-gray-500 text-xs mb-1">Total Notional</div>
          <div className="text-2xl font-bold text-white">
            ${(myPositions.reduce((sum, p) => sum + p.notional, 0) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        <button
          onClick={() => setActiveTab("positions")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
            activeTab === "positions"
              ? "text-white"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Positions
          {myPositions.length > 0 && (
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === "positions" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400"
            }`}>
              {myPositions.length}
            </span>
          )}
          {activeTab === "positions" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
            activeTab === "orders"
              ? "text-white"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Open Orders
          {myOrders.length > 0 && (
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === "orders" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400"
            }`}>
              {myOrders.length}
            </span>
          )}
          {activeTab === "orders" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t" />
          )}
        </button>
      </div>

      {/* ── Positions Tab ─────────────────────────────────────────── */}
      {activeTab === "positions" && (
        <div className="space-y-8">
          {/* Active positions */}
          <section>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Active ({activePositions.length})
            </h2>
            {activePositions.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 border-dashed rounded-xl p-10 text-center">
                <p className="text-gray-500 text-sm">No active positions.</p>
                <a
                  href="/"
                  className="inline-block mt-2 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
                >
                  Go to Markets to open one →
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {activePositions.map((p) => (
                  <PositionCard
                    key={p.publicKey}
                    position={p}
                    walletKey={publicKey.toBase58()}
                    onRefresh={loadPortfolio}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Closed positions */}
          {closedPositions.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                Closed ({closedPositions.length})
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {closedPositions.map((p) => (
                  <PositionCard
                    key={p.publicKey}
                    position={p}
                    walletKey={publicKey.toBase58()}
                    onRefresh={loadPortfolio}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Open Orders Tab ───────────────────────────────────────── */}
      {activeTab === "orders" && (
        <section>
          {myOrders.length === 0 ? (
            <div className="bg-gray-900/50 border border-gray-800 border-dashed rounded-xl p-10 text-center">
              <p className="text-gray-500 text-sm">No open orders.</p>
              <a
                href="/"
                className="inline-block mt-2 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
              >
                Go to Markets to place one →
              </a>
            </div>
          ) : (
            <>
              {cancelError && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-400 text-sm">
                  {cancelError}
                </div>
              )}
              <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Direction
                      </th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Notional
                      </th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Fixed Rate
                      </th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Duration
                      </th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Placed
                      </th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/70">
                    {myOrders.map((o) => (
                      <tr key={o.publicKey} className="hover:bg-gray-900/60 transition-colors group">
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${
                            o.direction === "FixedPayer"
                              ? "bg-indigo-900/60 text-indigo-400 border border-indigo-800/60"
                              : "bg-green-900/60 text-green-400 border border-green-800/60"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              o.direction === "FixedPayer" ? "bg-indigo-400" : "bg-green-400"
                            }`} />
                            {o.direction === "FixedPayer" ? "Fixed Payer" : "Floating Payer"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-white">
                          ${(o.notional / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-indigo-400">
                          {o.fixedRate} bps/8h
                        </td>
                        <td className="px-5 py-4 text-right text-gray-400 font-mono">
                          {o.durationPeriods * 8}h
                        </td>
                        <td className="px-5 py-4 text-right text-gray-500 text-xs tabular-nums">
                          {o.createdAt > 0 ? formatTimeAgo(o.createdAt) : "—"}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => handleCancelOrder(o.publicKey)}
                            disabled={cancellingOrder === o.publicKey}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors px-2 py-1 rounded hover:bg-red-900/20"
                          >
                            {cancellingOrder === o.publicKey ? "Cancelling…" : "Cancel"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
