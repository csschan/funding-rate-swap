"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";

/**
 * Global mock rate simulator — oscillates a funding rate every 3 seconds.
 * No RPC calls. Base rate is 50 bps/8h (realistic SOL-PERP range).
 */
export function RateSimulator() {
  const setLiveRate = useAppStore((s) => s.setLiveRate);
  const tickRef = useRef(0);
  const BASE = 50; // base funding rate in display bps

  useEffect(() => {
    setLiveRate(BASE);
    const id = setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current;
      const sine  = Math.sin((2 * Math.PI * t) / 60) * BASE * 0.25;
      const drift = (Math.random() - 0.495) * BASE * 0.04;
      const noise = (Math.random() - 0.5) * BASE * 0.06;
      const next  = Math.max(1, BASE + sine + drift + noise);
      setLiveRate(next);
    }, 3000);
    return () => clearInterval(id);
  }, [setLiveRate]);

  return null;
}
