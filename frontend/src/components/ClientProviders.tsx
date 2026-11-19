"use client";

import dynamic from "next/dynamic";
import { ReactNode, Suspense } from "react";
import { RateSimulator } from "./RateSimulator";

const SolanaWalletProvider = dynamic(
  () => import("./WalletProvider").then((m) => m.SolanaWalletProvider),
  { ssr: false }
);

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SolanaWalletProvider>
        <RateSimulator />
        {children}
      </SolanaWalletProvider>
    </Suspense>
  );
}
