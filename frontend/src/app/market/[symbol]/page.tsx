import { Suspense, use } from "react";
import { MarketPageWrapper } from "./MarketPageWrapper";
import { MARKETS } from "@/lib/constants";

export function generateStaticParams() {
  return MARKETS.map((m) => ({ symbol: m.symbol.toLowerCase() }));
}

export default function MarketPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  return (
    <Suspense fallback={<div className="text-center py-16 text-gray-500">Loading...</div>}>
      <MarketPageWrapper symbol={symbol} />
    </Suspense>
  );
}
