import { createContext, useContext, useState, ReactNode } from "react";
import { MarketDetail } from "@/lib/api-client";

type BetContextType = {
  selectedMarket: MarketDetail | null;
  setSelectedMarket: (market: MarketDetail | null) => void;
  selectedOutcomeIndex: number | null;
  setSelectedOutcomeIndex: (index: number | null) => void;
  stake: number;
  setStake: (stake: number) => void;
};

const BetContext = createContext<BetContextType | undefined>(undefined);

export function BetProvider({ children }: { children: ReactNode }) {
  const [selectedMarket, setSelectedMarket] = useState<MarketDetail | null>(null);
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState<number | null>(null);
  const [stake, setStake] = useState<number>(0.1);

  return (
    <BetContext.Provider
      value={{
        selectedMarket,
        setSelectedMarket,
        selectedOutcomeIndex,
        setSelectedOutcomeIndex,
        stake,
        setStake,
      }}
    >
      {children}
    </BetContext.Provider>
  );
}

export function useBet() {
  const context = useContext(BetContext);
  if (context === undefined) {
    throw new Error("useBet must be used within a BetProvider");
  }
  return context;
}
