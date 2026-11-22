import { create } from "zustand";
import { PublicKey } from "@solana/web3.js";

export interface Position {
  publicKey: string;
  market: string;
  fixedPayer: string;
  floatingPayer: string;
  notional: number;       // USDC (6 decimals raw → display as /1e6)
  fixedRate: number;      // bps per period
  startTime: number;
  totalPeriods: number;
  settledPeriods: number;
  lastFundingRate: number; // last observed floating rate
  lastSettledAt: number;
  fixedVault: string;
  floatingVault: string;
  positionId: number;
  isActive: boolean;
  fixedVaultBalance: number;
  floatingVaultBalance: number;
}

export interface Order {
  publicKey: string;
  market: string;
  owner: string;
  direction: "FixedPayer" | "FloatingPayer";
  notional: number;
  fixedRate: number;
  durationPeriods: number;
  createdAt: number;
}

export interface MarketData {
  name: string;
  symbol: string;
  currentFundingRate: number;   // bps per period
  impliedFixedRate: number;     // mid of orderbook
  volume24h: number;
  swapMarket: string;
  fundingSource: string;        // "Jupiter" | "Pacifica"
  fundingInterval: string;      // "1h"
}

// Perp position from Jupiter / Pacifica
export interface PerpPositionData {
  platform: "Jupiter" | "Pacifica";
  symbol: string;
  side: "Long" | "Short";
  sizeUsd: number;
  collateralUsd: number;
  entryPrice: number;
  leverage: number;
  owner: string;
}

interface AppState {
  markets: MarketData[];
  myPositions: Position[];
  myOrders: Order[];
  perpPositions: PerpPositionData[];
  isLoading: boolean;
  liveRate: number;

  setMarkets: (m: MarketData[]) => void;
  setMyPositions: (p: Position[]) => void;
  setMyOrders: (o: Order[]) => void;
  setPerpPositions: (p: PerpPositionData[]) => void;
  setLoading: (v: boolean) => void;
  updateMarketRate: (swapMarket: string, rate: number) => void;
  setLiveRate: (rate: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  markets: [],
  myPositions: [],
  myOrders: [],
  perpPositions: [],
  isLoading: false,
  liveRate: 50,

  setMarkets: (markets) => set({ markets }),
  setMyPositions: (myPositions) => set({ myPositions }),
  setMyOrders: (myOrders) => set({ myOrders }),
  setPerpPositions: (perpPositions) => set({ perpPositions }),
  setLoading: (isLoading) => set({ isLoading }),
  setLiveRate: (liveRate) => set({ liveRate }),
  updateMarketRate: (swapMarket, rate) =>
    set((state) => ({
      markets: state.markets.map((m) =>
        m.swapMarket === swapMarket ? { ...m, currentFundingRate: rate } : m
      ),
    })),
}));
