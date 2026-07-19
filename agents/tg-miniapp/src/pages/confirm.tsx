import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@/lib/wallet-modal";
import { useBet } from "@/lib/bet-context";
import { usePlaceSlip, getListSlipsQueryKey } from "@/lib/api-client";
import { usePlaceSlipOnChain } from "@/lib/program";
import { WalletButton } from "@/components/wallet-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatOdds, formatSol } from "@/lib/utils";
import {
  ShieldCheck,
  ArrowLeft,
  Loader2,
  Wallet,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";

type PlacementMode = "offchain" | "onchain";

export default function Confirm() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { selectedMarket, selectedOutcomeIndex, stake } = useBet();
  const { publicKey } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  const [mode, setMode] = useState<PlacementMode>("offchain");
  const [txSig, setTxSig] = useState<string | null>(null);

  // REST slip (off-chain)
  const placeSlipRest = usePlaceSlip();
  // On-chain slip
  const placeSlipOnChain = usePlaceSlipOnChain();

  useEffect(() => {
    if (!selectedMarket || selectedOutcomeIndex === null) {
      setLocation("/");
    }
  }, [selectedMarket, selectedOutcomeIndex, setLocation]);

  if (!selectedMarket || selectedOutcomeIndex === null) return null;

  const outcome = selectedMarket.outcomes[selectedOutcomeIndex];
  const odds = 1 / outcome.price;
  const potentialPayout = stake * odds;

  const isPending =
    mode === "offchain" ? placeSlipRest.isPending : placeSlipOnChain.isPending;
  const errorMsg =
    mode === "offchain"
      ? (placeSlipRest.error as Error)?.message
      : (placeSlipOnChain.error as Error)?.message;

  const handleConfirmRest = () => {
    setMode("offchain");
    placeSlipRest.mutate(
      {
        data: {
          market_id: selectedMarket.market_id,
          outcome_index: selectedOutcomeIndex,
          stake_sol: stake,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSlipsQueryKey() });
          setLocation("/positions");
        },
      }
    );
  };

  const handleConfirmOnChain = () => {
    if (!publicKey) {
      openWalletModal(true);
      return;
    }
    setMode("onchain");
    placeSlipOnChain.mutate(
      {
        marketId: Number(selectedMarket.market_id),
        outcomeId: selectedOutcomeIndex,
        numShares: Math.round(stake * 1000), // shares proportional to stake
        stakeUi: stake,
      },
      {
        onSuccess: ({ signature }) => {
          setTxSig(signature);
          queryClient.invalidateQueries({ queryKey: getListSlipsQueryKey() });
          setTimeout(() => setLocation("/positions"), 2000);
        },
      }
    );
  };

  // Submitted on-chain successfully
  if (txSig) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh max-w-[430px] mx-auto p-8 gap-6">
        <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9 text-success" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Bet Placed On-Chain!</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your bet slip has been submitted to the Solana devnet.
          </p>
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-primary underline underline-offset-2"
          >
            View on Solana Explorer
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            className="-ml-2 mr-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-bold">Confirm Stake</h1>
        </div>
        <WalletButton />
      </div>

      <main className="flex-1 p-4 pb-24 flex flex-col">
        {/* Bet details card */}
        <Card className="p-6 mb-6 border-primary/20 bg-card/50 backdrop-blur">
          <div className="flex items-center gap-2 mb-6 pb-6 border-b border-border/50">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-xl">🇻🇳</span>
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
                {selectedMarket.market_type === "1x2"
                  ? "Match Winner"
                  : selectedMarket.market_type === "over_under"
                  ? "Totals"
                  : "Both Teams To Score"}
              </div>
              <div className="text-lg font-bold text-foreground">
                {outcome.label}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">
                Odds
              </div>
              <div className="text-lg font-mono font-bold text-primary">
                {formatOdds(odds)}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-muted-foreground">Stake Amount</span>
            <span className="text-lg font-mono font-bold">
              {formatSol(stake)}
            </span>
          </div>

          <div className="flex justify-between items-center text-primary">
            <span className="text-sm font-medium">Potential Payout</span>
            <span className="text-xl font-mono font-bold">
              {formatSol(potentialPayout)}
            </span>
          </div>
        </Card>

        {/* Error display */}
        {errorMsg && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            {errorMsg}
          </div>
        )}

        {/* Trust badges */}
        <div className="space-y-3 mt-auto">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/30 border border-border/40">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold mb-0.5">
                Secured by Solana Devnet
              </div>
              <div className="text-[11px] text-muted-foreground">
                Bets settled by the quadratic_market smart contract. No
                counterparty risk.
              </div>
            </div>
          </div>

          {/* On-chain CTA */}
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-primary">
                Place on-chain
              </span>
              {publicKey ? (
                <span className="text-[10px] font-mono text-muted-foreground">
                  {publicKey.toBase58().slice(0, 6)}…
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  Wallet not connected
                </span>
              )}
            </div>

            {!publicKey ? (
              <Button
                className="w-full gap-2 font-bold"
                onClick={() => openWalletModal(true)}
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet to Sign
              </Button>
            ) : (
              <Button
                className="w-full gap-2 font-bold bg-primary hover:bg-primary/90"
                onClick={handleConfirmOnChain}
                disabled={isPending}
              >
                {placeSlipOnChain.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing…
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    Confirm & Sign
                    <ChevronRight className="w-4 h-4 ml-auto" />
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Off-chain fallback */}
          <div className="text-center">
            <span className="text-xs text-muted-foreground">
              Don't have a wallet?{" "}
            </span>
            <button
              onClick={handleConfirmRest}
              disabled={placeSlipRest.isPending}
              className="text-xs text-primary underline underline-offset-2 disabled:opacity-50"
            >
              {placeSlipRest.isPending ? "Placing…" : "Place off-chain"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
