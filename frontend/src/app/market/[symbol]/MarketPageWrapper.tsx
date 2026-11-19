"use client";

import dynamic from "next/dynamic";

const MarketPageClient = dynamic(
  () => import("./MarketPageClient").then((m) => m.MarketPageClient),
  {
    ssr: false,
    loading: () => (
      <div className="text-center py-16 text-gray-500">Loading...</div>
    ),
  }
);

export function MarketPageWrapper({ symbol }: { symbol: string }) {
  return <MarketPageClient symbol={symbol} />;
}
