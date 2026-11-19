"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Navbar() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");

  const links = [
    { href: "/", label: "Markets" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  async function handleFaucet() {
    if (!publicKey) return;
    setFaucetLoading(true);
    setFaucetMsg("");
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const data = await res.json();
      if (data.success) {
        setFaucetMsg("10,000 USDC received!");
      } else {
        setFaucetMsg("Error: " + data.error);
      }
    } catch (err: any) {
      setFaucetMsg("Failed");
    } finally {
      setFaucetLoading(false);
      setTimeout(() => setFaucetMsg(""), 5000);
    }
  }

  return (
    <nav className="border-b border-gray-800 bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-bold text-white text-lg tracking-tight">
            FundingSwap
          </span>
          <div className="flex gap-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  pathname === href
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {faucetMsg && (
            <span className="text-xs text-green-400">{faucetMsg}</span>
          )}
          {publicKey && (
            <button
              onClick={handleFaucet}
              disabled={faucetLoading}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {faucetLoading ? "Minting..." : "Faucet USDC"}
            </button>
          )}
          <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-500 !text-sm !h-8 !rounded" />
        </div>
      </div>
    </nav>
  );
}
