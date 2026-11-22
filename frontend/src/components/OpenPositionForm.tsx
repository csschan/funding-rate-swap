"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { DURATION_OPTIONS } from "@/lib/constants";
import { buildOpenPositionAmmTx, Direction } from "@/lib/program";

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10];

interface Props {
  currentRate: number;
  impliedFixedRate: number;
  onSuccess?: () => void;
  hedgeDirection?: "fixed" | "floating" | null;
  hedgeNotional?: number;
}

type DirectionLabel = "FixedPayer" | "FloatingPayer";

export function OpenPositionForm({ currentRate, impliedFixedRate, onSuccess, hedgeDirection, hedgeNotional }: Props) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const defaultDirection: DirectionLabel = hedgeDirection === "floating" ? "FloatingPayer" : "FixedPayer";
  const defaultNotional = hedgeNotional ? String(hedgeNotional) : "10000";

  const [direction, setDirection] = useState<DirectionLabel>(defaultDirection);
  const [notional, setNotional] = useState(defaultNotional);
  const [fixedRate, setFixedRate] = useState(impliedFixedRate.toFixed(2));
  const [durationIdx, setDurationIdx] = useState(0);
  const [leverage, setLeverage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txSig, setTxSig] = useState("");

  const duration = DURATION_OPTIONS[durationIdx];
  const notionalNum = parseFloat(notional) || 0;
  const rateNum = parseFloat(fixedRate) || 0;
  // Effective position = notional × leverage; collateral is what you actually deposit
  const effectiveNotional = notionalNum * leverage;
  const collateral = notionalNum; // the input IS the collateral/margin


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    setLoading(true);
    setError("");
    setTxSig("");

    try {
      // Check wallet is on devnet
      const walletBalance = await connection.getBalance(publicKey);
      if (walletBalance === 0) {
        // Try a known devnet account to verify network
        const devnetCheck = await connection.getBalance(new (await import("@solana/web3.js")).PublicKey("11111111111111111111111111111111"));
        if (devnetCheck === 0) throw new Error("Please switch your wallet to Devnet network");
      }

      const notionalRaw = BigInt(Math.floor(effectiveNotional * 1_000_000)); // USDC 6 decimals
      const fixedRateBps = BigInt(Math.round(rateNum * 100));                // bps * 100 to match contract
      const collateralRaw = BigInt(Math.floor(collateral * 1_000_000));

      // Build tx — opens position instantly against protocol AMM
      const { tx } = await buildOpenPositionAmmTx(connection, publicKey, {
        direction: direction === "FixedPayer" ? Direction.FixedPayer : Direction.FloatingPayer,
        notional: notionalRaw,
        fixedRate: fixedRateBps,
        durationPeriods: duration.periods,
        collateralAmount: collateralRaw,
      });

      // Get fresh blockhash RIGHT before sending to avoid expiry
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const sig = await sendTransaction(tx, connection, {
        skipPreflight: true,  // skip simulation to reduce latency
        maxRetries: 3,
      });

      // Poll for confirmation instead of waiting on a single promise
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await connection.getSignatureStatus(sig);
        const conf = status?.value?.confirmationStatus;
        if (conf === "confirmed" || conf === "finalized") { confirmed = true; break; }
        if (status?.value?.err) throw new Error("Transaction failed: " + JSON.stringify(status.value.err));
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!confirmed) throw new Error("Transaction not confirmed after 60s — check Explorer");

      setTxSig(sig);
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Direction */}
      <div>
        <label className="block text-xs text-gray-400 mb-2">Direction</label>
        <div className="grid grid-cols-2 gap-2">
          {(["FixedPayer", "FloatingPayer"] as DirectionLabel[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`py-2.5 rounded text-sm font-medium border transition-colors ${
                direction === d
                  ? d === "FixedPayer"
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-green-700 border-green-700 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {d === "FixedPayer" ? "Fixed Payer (Hedge)" : "Floating Payer (Yield)"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          {direction === "FixedPayer"
            ? "For perp longs already paying funding. Converts variable funding cost to fixed — eliminates rate uncertainty."
            : "Earn guaranteed fixed rate. Profit when funding rate stays below your fixed rate."}
        </p>
      </div>

      {/* Notional */}
      <div>
        <label className="block text-xs text-gray-400 mb-2">Notional (USDC)</label>
        <input
          type="number"
          value={notional}
          onChange={(e) => setNotional(e.target.value)}
          min="100"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Fixed Rate */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-gray-400">
            {direction === "FixedPayer" ? "Max Fixed Rate (bps/h)" : "Min Fixed Rate (bps/h)"}
          </label>
          <span className="text-xs text-gray-500">
            Market: <span className="text-indigo-400">{impliedFixedRate.toFixed(2)}</span>
          </span>
        </div>
        <input
          type="number"
          value={fixedRate}
          onChange={(e) => setFixedRate(e.target.value)}
          step="0.01"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Duration */}
      <div>
        <label className="block text-xs text-gray-400 mb-2">Duration</label>
        <div className="grid grid-cols-3 gap-2">
          {DURATION_OPTIONS.map((opt, i) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setDurationIdx(i)}
              className={`py-2 rounded text-sm border transition-colors ${
                durationIdx === i
                  ? "bg-gray-700 border-gray-600 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Leverage */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-gray-400">Leverage</label>
          <span className="text-xs text-indigo-400 font-mono">{leverage}x</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {LEVERAGE_OPTIONS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLeverage(lv)}
              className={`py-2 rounded text-sm border transition-colors ${
                leverage === lv
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {lv}x
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-600">
          {leverage > 1
            ? `Deposit $${notionalNum} → control $${effectiveNotional.toFixed(0)} position (${leverage}x)`
            : "1x — deposit equals position size, no leverage"}
        </p>
      </div>

      {/* Summary */}
      <div className="bg-gray-900 rounded-lg p-4 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Margin</span>
          <span className="text-white font-mono">${collateral.toFixed(0)} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Position Size</span>
          <span className="text-white font-mono">
            ${effectiveNotional.toFixed(0)} USDC
            {leverage > 1 && <span className="text-indigo-400 ml-1">({leverage}x)</span>}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Duration</span>
          <span className="text-white">{duration.periods}h ({duration.label})</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Fixed Rate</span>
          <span className="text-indigo-400 font-mono">{rateNum.toFixed(2)} bps/h</span>
        </div>

        {/* Scenario table */}
        <div className="border-t border-gray-800 pt-2">
          <div className="text-xs text-gray-500 mb-2">If avg funding rate over duration is…</div>
          <div className="space-y-1.5">
            {[
              { scenarioRate: rateNum - 20 },
              { scenarioRate: rateNum },
              { scenarioRate: rateNum + 20 },
            ].map(({ scenarioRate }) => {
              const pnl =
                direction === "FixedPayer"
                  ? (scenarioRate - rateNum) * effectiveNotional * duration.periods / 10_000
                  : (rateNum - scenarioRate) * effectiveNotional * duration.periods / 10_000;
              const isBreakeven = scenarioRate === rateNum;
              return (
                <div key={scenarioRate} className="flex justify-between text-xs items-center">
                  <span className="text-gray-400 font-mono">
                    {scenarioRate.toFixed(1)} bps/h
                    {isBreakeven && <span className="text-gray-600 ml-1">(breakeven)</span>}
                  </span>
                  <span className={`font-mono font-semibold ${pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-400"}`}>
                    {pnl > 0 ? "+" : ""}{pnl === 0 ? "±" : ""}${pnl.toFixed(0)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-800">
            {direction === "FixedPayer"
              ? `You profit when rate rises above ${rateNum.toFixed(1)} bps — locks in hedge cost for perp longs`
              : `You profit when rate falls below ${rateNum.toFixed(1)} bps — earns fixed yield on idle capital`}
          </div>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-900/20 rounded p-2">{error}</p>
      )}

      {txSig && (
        <p className="text-green-400 text-xs bg-green-900/20 rounded p-2">
          Order placed!{" "}
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View on Explorer
          </a>
        </p>
      )}

      <button
        type="submit"
        disabled={!publicKey || loading}
        className="w-full py-3 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
      >
        {!publicKey ? "Connect Wallet" : loading ? "Placing Order..." : "Place Order"}
      </button>
    </form>
  );
}
