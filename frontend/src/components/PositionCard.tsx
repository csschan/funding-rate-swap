"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Position, useAppStore } from "@/store/useAppStore";
import { buildAddCollateralTx, buildClosePositionTx, buildEarlyCloseAmmTx } from "@/lib/program";
import { USDC_MINT_DEVNET } from "@/lib/constants";
import { deriveProtocolAmm } from "@/lib/pda";

interface Props {
  position: Position;
  walletKey: string;
  onRefresh?: () => void;
}

export function PositionCard({ position, walletKey, onRefresh }: Props) {
  const { connection } = useConnection();
  const { sendTransaction } = useWallet();

  const [addCollateralLoading, setAddCollateralLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [collateralInput, setCollateralInput] = useState("");
  const [showCollateralInput, setShowCollateralInput] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const liveRate = useAppStore((s) => s.liveRate);
  const ammPubkey = deriveProtocolAmm().toBase58();
  const isAmmPosition = position.fixedPayer === ammPubkey || position.floatingPayer === ammPubkey;
  const isFixedPayer = position.fixedPayer === walletKey;
  // position.fixedRate is stored as bps×100 in contract (e.g. 4500 = 45.00 display bps)
  // liveRate is display bps (e.g. 45.00). Convert for comparison.
  const fixedRateDisplay = position.fixedRate / 100; // contract units → display bps
  // For AMM positions, use live mock rate; fall back to lastFundingRate (also in display bps)
  const effectiveRate = isAmmPosition && liveRate > 0 ? liveRate : position.lastFundingRate / 100;
  const myVaultBalance = isFixedPayer
    ? position.fixedVaultBalance / 1e6
    : position.floatingVaultBalance / 1e6;
  const notionalUsd = position.notional / 1e6;
  const healthPct = notionalUsd > 0 ? (myVaultBalance / notionalUsd) * 100 : 0;

  const periodsLeft = position.totalPeriods - position.settledPeriods;
  const hoursLeft = periodsLeft * 8;
  const progressPct =
    position.totalPeriods > 0
      ? (position.settledPeriods / position.totalPeriods) * 100
      : 0;

  // rateSpread in display bps (both values now in display bps)
  const rateSpread = isFixedPayer
    ? effectiveRate - fixedRateDisplay   // fixed payer profits when floating > fixed
    : fixedRateDisplay - effectiveRate;  // floating payer profits when fixed > floating

  // "If you close now" P&L — use fractional periods for real-time display
  const nowSecPnl = Date.now() / 1000;
  const elapsedSec = Math.max(0, nowSecPnl - position.lastSettledAt);
  const elapsedFractional = Math.min(elapsedSec / 28800, position.totalPeriods - position.settledPeriods);
  const totalPeriodsAccrued = position.settledPeriods + elapsedFractional;
  const estimatedPnlPerPeriod = (rateSpread / 10_000) * notionalUsd;
  const estimatedTotalPnl = estimatedPnlPerPeriod * Math.max(totalPeriodsAccrued, 1);

  // Time until next settlement (8h cycle from lastSettledAt)
  const secSinceSettle = nowSecPnl - position.lastSettledAt;
  const nextSettleInHours = secSinceSettle > 0
    ? 8 - (secSinceSettle / 3600) % 8
    : 8;

  // Format duration remaining
  function formatDuration(hours: number): string {
    if (hours <= 0) return "Ended";
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    if (days > 0) return `${days}d ${remainHours}h`;
    return `${remainHours}h`;
  }

  async function handleAddCollateral() {
    if (!collateralInput || isNaN(Number(collateralInput))) return;
    setAddCollateralLoading(true);
    setTxError(null);
    try {
      const amount = BigInt(Math.round(Number(collateralInput) * 1e6));
      const side = isFixedPayer ? "fixed" : "floating";
      const tx = await buildAddCollateralTx(
        connection,
        new PublicKey(walletKey),
        new PublicKey(position.publicKey),
        new PublicKey(position.fixedVault),
        new PublicKey(position.floatingVault),
        amount,
        side,
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setCollateralInput("");
      setShowCollateralInput(false);
      onRefresh?.();
    } catch (err: any) {
      setTxError(err?.message ?? "Transaction failed");
    } finally {
      setAddCollateralLoading(false);
    }
  }

  async function handleClosePosition() {
    setCloseLoading(true);
    setTxError(null);
    try {
      const callerKey = new PublicKey(walletKey);

      let tx;
      if (isAmmPosition) {
        // current_rate must be in same units as fixed_rate (bps×100)
        // effectiveRate is display bps → multiply by 100 for contract
        const closeRateContractUnits = BigInt(Math.round(effectiveRate * 100));
        tx = await buildEarlyCloseAmmTx(
          connection,
          callerKey,
          BigInt(position.positionId),
          closeRateContractUnits,
        );
      } else {
        const fixedPayerKey = new PublicKey(position.fixedPayer);
        const floatingPayerKey = new PublicKey(position.floatingPayer);
        const [fixedPayerUsdc, floatingPayerUsdc] = await Promise.all([
          getAssociatedTokenAddress(USDC_MINT_DEVNET, fixedPayerKey),
          getAssociatedTokenAddress(USDC_MINT_DEVNET, floatingPayerKey),
        ]);
        tx = await buildClosePositionTx(
          connection,
          callerKey,
          new PublicKey(position.publicKey),
          new PublicKey(position.fixedVault),
          new PublicKey(position.floatingVault),
          fixedPayerUsdc,
          floatingPayerUsdc,
        );
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      onRefresh?.();
    } catch (err: any) {
      setTxError(err?.message ?? "Transaction failed");
    } finally {
      setCloseLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4 hover:border-gray-700 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold">SOL-PERP</span>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            isFixedPayer
              ? "bg-indigo-900/60 text-indigo-400 border border-indigo-800/60"
              : "bg-green-900/60 text-green-400 border border-green-800/60"
          }`}>
            {isFixedPayer ? "Fixed Payer" : "Floating Payer"}
          </span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${
          position.isActive
            ? "bg-emerald-900/50 text-emerald-400"
            : "bg-gray-700/60 text-gray-400"
        }`}>
          {position.isActive ? "Active" : "Closed"}
        </span>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <div className="text-gray-500 text-xs mb-0.5">Notional</div>
          <div className="text-white font-mono font-medium">
            ${notionalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-gray-500 text-xs mb-0.5">Fixed Rate</div>
          <div className="text-indigo-400 font-mono font-medium">
            {fixedRateDisplay.toFixed(2)} bps/h
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-gray-500 text-xs mb-0.5">
            {isAmmPosition && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
            )}
            {isAmmPosition ? "Live Rate" : "Last Funding"}
          </div>
          <div className={`font-mono font-medium transition-colors duration-500 ${
            effectiveRate >= fixedRateDisplay ? "text-green-400" : "text-red-400"
          }`}>
            {effectiveRate.toFixed(2)} bps/h
          </div>
        </div>
        <div>
          <div className="text-gray-500 text-xs mb-0.5">
            {isAmmPosition ? "P&L (close now)" : "Est. P&L"}
          </div>
          <div className={`font-mono font-medium transition-colors duration-500 ${
            estimatedTotalPnl >= 0 ? "text-green-400" : "text-red-400"
          }`}>
            {estimatedTotalPnl >= 0 ? "+" : ""}
            ${estimatedTotalPnl.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-gray-500 text-xs mb-0.5">Duration Remaining</div>
          <div className="text-white font-mono">{formatDuration(hoursLeft)}</div>
        </div>
        <div>
          <div className="text-gray-500 text-xs mb-0.5">Next Settlement</div>
          <div className="text-yellow-400 font-mono">{nextSettleInHours.toFixed(1)}h</div>
        </div>
      </div>

      {/* Period progress bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">
            Progress — {position.settledPeriods}/{position.totalPeriods} periods
          </span>
          <span className="text-gray-400">{progressPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.min(100, progressPct)}%` }}
          />
        </div>
      </div>

      {/* Collateral health bar */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">
            Collateral — ${myVaultBalance.toFixed(2)}
          </span>
          <span className={
            healthPct < 5 ? "text-red-400" : healthPct < 10 ? "text-yellow-400" : "text-green-400"
          }>
            {healthPct.toFixed(1)}% health
          </span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              healthPct < 5 ? "bg-red-500" : healthPct < 10 ? "bg-yellow-500" : "bg-green-500"
            }`}
            style={{ width: `${Math.min(100, healthPct)}%` }}
          />
        </div>
      </div>

      {/* Add Collateral inline input */}
      {showCollateralInput && (
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="1"
              placeholder="USDC amount"
              value={collateralInput}
              onChange={(e) => setCollateralInput(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-6 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            onClick={handleAddCollateral}
            disabled={addCollateralLoading || !collateralInput}
            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            {addCollateralLoading ? "Adding..." : "Confirm"}
          </button>
          <button
            onClick={() => { setShowCollateralInput(false); setCollateralInput(""); }}
            className="px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error message */}
      {txError && (
        <p className="text-red-400 text-xs truncate" title={txError}>
          {txError}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {!showCollateralInput && (
          <button
            onClick={() => { setShowCollateralInput(true); setTxError(null); }}
            className="flex-1 py-2 rounded border border-gray-700 text-gray-300 hover:border-indigo-500 hover:text-indigo-400 text-xs font-medium transition-colors"
          >
            Add Collateral
          </button>
        )}
        {position.isActive && (
          <button
            onClick={handleClosePosition}
            disabled={closeLoading}
            className="flex-1 py-2 rounded bg-red-900/40 border border-red-800/60 text-red-400 hover:bg-red-800/50 hover:text-red-300 disabled:opacity-50 text-xs font-medium transition-colors"
          >
            {closeLoading ? "Closing..." : isAmmPosition ? "Close Now" : "Close Position"}
          </button>
        )}
        {!position.isActive && (
          <span className="flex-1 py-2 text-center text-gray-600 text-xs">
            Position closed
          </span>
        )}
      </div>
    </div>
  );
}
