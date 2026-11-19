"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";

// SwapOrder discriminator: [120, 0, 228, 80, 167, 248, 73, 201]
const DISC_ORDER = new Uint8Array([120, 0, 228, 80, 167, 248, 73, 201]);

// Convert discriminator bytes to base64 for memcmp filter
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface SwapOrder {
  publicKey: string;
  market: string;
  owner: string;
  direction: "FixedPayer" | "FloatingPayer";
  notional: number;    // raw u64 (USDC 6 decimals)
  fixedRate: number;   // raw i64 bps
  durationPeriods: number;
  createdAt: number;   // unix timestamp seconds
}

/**
 * Decode a SwapOrder account from raw bytes using DataView (browser-safe, no Buffer).
 *
 * Layout after 8-byte discriminator:
 *   market          Pubkey  offset 8   (32 bytes)
 *   owner           Pubkey  offset 40  (32 bytes)
 *   direction       u8      offset 72  (1 byte)
 *   notional        u64     offset 73  (8 bytes, LE)
 *   fixed_rate      i64     offset 81  (8 bytes, LE)
 *   duration_periods u32    offset 89  (4 bytes, LE)
 *   created_at      i64     offset 93  (8 bytes, LE)
 *   order_id        u64     offset 101 (8 bytes, LE)
 */
function decodeSwapOrder(pubkey: PublicKey, raw: Uint8Array): SwapOrder | null {
  try {
    // Minimum length check: discriminator(8) + market(32) + owner(32) + direction(1) +
    // notional(8) + fixed_rate(8) + duration_periods(4) + created_at(8) = 101 bytes minimum
    if (raw.length < 101) return null;

    // Verify discriminator
    for (let i = 0; i < 8; i++) {
      if (raw[i] !== DISC_ORDER[i]) return null;
    }

    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    // market pubkey: bytes 8..40
    const market = new PublicKey(raw.slice(8, 40)).toBase58();
    // owner pubkey: bytes 40..72
    const owner = new PublicKey(raw.slice(40, 72)).toBase58();
    // direction: byte 72
    const directionByte = raw[72];
    const direction = directionByte === 0 ? "FixedPayer" : "FloatingPayer";
    // notional: u64 LE at offset 73
    const notionalLo = view.getUint32(73, true);
    const notionalHi = view.getUint32(77, true);
    const notional = notionalLo + notionalHi * 0x100000000;
    // fixed_rate: i64 LE at offset 81
    const rateLo = view.getUint32(81, true);
    const rateHi = view.getInt32(85, true);
    const fixedRate = rateLo + rateHi * 0x100000000;
    // duration_periods: u32 LE at offset 89
    const durationPeriods = view.getUint32(89, true);
    // created_at: i64 LE at offset 93
    const createdAtLo = view.getUint32(93, true);
    const createdAtHi = view.getInt32(97, true);
    const createdAt = createdAtLo + createdAtHi * 0x100000000;

    return {
      publicKey: pubkey.toBase58(),
      market,
      owner,
      direction: direction as "FixedPayer" | "FloatingPayer",
      notional,
      fixedRate,
      durationPeriods,
      createdAt,
    };
  } catch {
    return null;
  }
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatNotional(raw: number): string {
  const usdc = raw / 1_000_000;
  if (usdc >= 1_000_000) return `$${(usdc / 1_000_000).toFixed(2)}M`;
  if (usdc >= 1_000) return `$${(usdc / 1_000).toFixed(1)}k`;
  return `$${usdc.toFixed(0)}`;
}

interface OrderRowProps {
  order: SwapOrder;
  side: "fixed" | "floating";
}

function OrderRow({ order, side }: OrderRowProps) {
  const rateDisplay = (order.fixedRate / 100).toFixed(2); // stored as bps*100
  const notionalDisplay = formatNotional(order.notional);
  const durationLabel =
    order.durationPeriods >= 90
      ? "30d"
      : order.durationPeriods >= 42
      ? "14d"
      : order.durationPeriods >= 21
      ? "7d"
      : `${order.durationPeriods}p`;
  const ago = timeAgo(order.createdAt);

  const ownerShort =
    order.owner.slice(0, 4) + "…" + order.owner.slice(-4);

  return (
    <div
      className={`grid grid-cols-5 gap-2 py-1.5 px-2 rounded text-xs font-mono border-b border-gray-800/50 last:border-b-0 hover:bg-gray-800/40 transition-colors ${
        side === "fixed" ? "text-indigo-200" : "text-green-200"
      }`}
    >
      <span
        className={`font-semibold ${
          side === "fixed" ? "text-indigo-400" : "text-green-400"
        }`}
      >
        {rateDisplay}
      </span>
      <span className="text-gray-300">{notionalDisplay}</span>
      <span className="text-gray-400">{durationLabel}</span>
      <span className="text-gray-500 truncate">{ownerShort}</span>
      <span className="text-gray-600 text-right">{ago}</span>
    </div>
  );
}

interface Props {
  marketPubkey: PublicKey;
}

export function OrderBook({ marketPubkey }: Props) {
  const { connection } = useConnection();
  const [fixedOrders, setFixedOrders] = useState<SwapOrder[]>([]);
  const [floatingOrders, setFloatingOrders] = useState<SwapOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: toBase64(DISC_ORDER),
              encoding: "base64" as const,
            },
          },
          {
            // market pubkey at offset 8
            memcmp: {
              offset: 8,
              bytes: marketPubkey.toBase58(),
            },
          },
        ],
      });

      const decoded: SwapOrder[] = [];
      for (const { pubkey, account } of accounts) {
        // account.data may arrive as Buffer (Node) or Uint8Array — normalize
        const raw =
          account.data instanceof Uint8Array
            ? account.data
            : new Uint8Array(account.data);
        const order = decodeSwapOrder(pubkey, raw);
        if (order) decoded.push(order);
      }

      // Fixed Payer: descending by fixedRate (highest rate shown first — most willing to pay)
      const fixed = decoded
        .filter((o) => o.direction === "FixedPayer")
        .sort((a, b) => b.fixedRate - a.fixedRate);

      // Floating Payer: ascending by fixedRate (lowest rate shown first — most attractive yield)
      const floating = decoded
        .filter((o) => o.direction === "FloatingPayer")
        .sort((a, b) => a.fixedRate - b.fixedRate);

      setFixedOrders(fixed);
      setFloatingOrders(floating);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("OrderBook fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [connection, marketPubkey]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 60_000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const columnHeader = (
    <div className="grid grid-cols-5 gap-2 px-2 pb-1.5 text-xs text-gray-600 font-medium border-b border-gray-800 mb-1">
      <span>Rate (bps)</span>
      <span>Notional</span>
      <span>Duration</span>
      <span>Maker</span>
      <span className="text-right">Age</span>
    </div>
  );

  const totalOrders = fixedOrders.length + floatingOrders.length;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
          Order Book
        </h2>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-600">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <span className="text-xs text-gray-500">
            {totalOrders} open order{totalOrders !== 1 ? "s" : ""}
          </span>
          <div
            className={`w-2 h-2 rounded-full ${
              loading ? "bg-yellow-500 animate-pulse" : "bg-green-500"
            }`}
          />
        </div>
      </div>

      {loading && totalOrders === 0 ? (
        <div className="flex items-center justify-center py-8 text-gray-600 text-sm">
          Loading orders…
        </div>
      ) : totalOrders === 0 ? (
        <div className="flex items-center justify-center py-8 text-gray-600 text-sm">
          No open orders for this market
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {/* Fixed Payer (Hedge) — blue */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">
                Fixed Payer (Hedge)
              </span>
              <span className="text-xs text-gray-600 bg-indigo-900/30 px-1.5 py-0.5 rounded">
                {fixedOrders.length}
              </span>
            </div>
            {columnHeader}
            {fixedOrders.length === 0 ? (
              <div className="text-xs text-gray-700 py-3 px-2">
                No fixed payer orders
              </div>
            ) : (
              fixedOrders.map((order) => (
                <OrderRow key={order.publicKey} order={order} side="fixed" />
              ))
            )}
          </div>

          {/* Floating Payer (Yield) — green */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">
                Floating Payer (Yield)
              </span>
              <span className="text-xs text-gray-600 bg-green-900/30 px-1.5 py-0.5 rounded">
                {floatingOrders.length}
              </span>
            </div>
            {columnHeader}
            {floatingOrders.length === 0 ? (
              <div className="text-xs text-gray-700 py-3 px-2">
                No floating payer orders
              </div>
            ) : (
              floatingOrders.map((order) => (
                <OrderRow key={order.publicKey} order={order} side="floating" />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
