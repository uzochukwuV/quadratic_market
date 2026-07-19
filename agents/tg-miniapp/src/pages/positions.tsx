import { useLocation } from "wouter";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@/lib/wallet-modal";
import { useListSlips, useGetFixtureSummary } from "@/lib/api-client";
import { useOnChainSlips, useResolveSlip, slipStatusLabel, type OnChainSlip } from "@/lib/program";
import { fromOnChainAmount } from "@/lib/solana-config";
import { WalletButton } from "@/components/wallet-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSol, cn } from "@/lib/utils";
import {
  ArrowLeft,
  Inbox,
  Wallet,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";

const FIXTURE_ID = 18143850;

function statusColor(status: string): string {
  switch (status) {
    case "won":
      return "bg-success text-success-foreground";
    case "lost":
      return "bg-destructive text-destructive-foreground";
    case "active":
      return "bg-primary text-primary-foreground";
    case "pending":
      return "bg-yellow-500/20 text-yellow-400";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

interface OnChainSlipCardProps {
  slip: OnChainSlip;
}

function OnChainSlipCard({ slip }: OnChainSlipCardProps) {
  const status = slipStatusLabel(slip.status);
  const resolve = useResolveSlip();

  const canClaim = (status === "won" || status === "lost") && !slip.claimed;

  return (
    <Card className="p-4 border-primary/20 bg-card/50">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] text-primary font-mono font-bold uppercase tracking-widest mb-1">
            On-Chain · Slip #{slip.slipId.toString()}
          </div>
          <div className="text-sm font-bold">
            {slip.numLegs} leg{slip.numLegs !== 1 ? "s" : ""}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "uppercase text-[10px] tracking-widest font-bold border-transparent",
            statusColor(status)
          )}
        >
          {status}
        </Badge>
      </div>

      <div className="flex justify-between text-xs mb-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Stake</div>
          <div className="font-mono font-bold">
            {formatSol(fromOnChainAmount(BigInt(slip.totalStake.toString())))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground mb-0.5">Potential</div>
          <div className="font-mono font-bold text-primary">
            {formatSol(fromOnChainAmount(BigInt(slip.potentialPayout.toString())))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <a
          href={`https://explorer.solana.com/address/${slip.publicKey.toBase58()}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Explorer
        </a>

        {canClaim && (
          <Button
            size="sm"
            variant={status === "won" ? "default" : "outline"}
            className="ml-auto h-7 text-xs px-3"
            onClick={() => resolve.mutate(slip.slipId)}
            disabled={resolve.isPending}
          >
            {resolve.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : status === "won" ? (
              "Claim Payout"
            ) : (
              "Settle"
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function Positions() {
  const [, setLocation] = useLocation();
  const { publicKey } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  const { data: fixture } = useGetFixtureSummary(
    { fixture_id: FIXTURE_ID },
    { query: { queryKey: ["/api/fixture-summary", { fixture_id: FIXTURE_ID }] } }
  );

  const { data: restSlips, isLoading: restLoading } = useListSlips({
    query: { queryKey: ["/api/slips"] },
  });

  const { data: chainSlips, isLoading: chainLoading } = useOnChainSlips();

  const isLoading = restLoading || chainLoading;
  const hasAnyBets =
    (restSlips && restSlips.length > 0) ||
    (chainSlips && chainSlips.length > 0);

  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            className="-ml-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-bold">My Positions</h1>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success animate-live-dot" />
            <span className="text-[10px] font-mono font-bold text-success uppercase tracking-widest">
              Live
            </span>
          </div>
        </div>
        <WalletButton />
      </div>

      {/* Fixture strip */}
      <div className="bg-secondary/40 border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <div className="font-semibold text-sm">
          {fixture?.home_team ?? "Vietnam"}{" "}
          <span className="text-muted-foreground font-normal mx-1">vs</span>{" "}
          {fixture?.away_team ?? "Myanmar"}
        </div>
        <div className="flex items-center gap-3 text-sm font-mono font-bold">
          <span className="text-primary">{fixture?.home_score ?? 0}</span>
          <span className="text-muted-foreground">-</span>
          <span className="text-primary">{fixture?.away_score ?? 0}</span>
        </div>
      </div>

      <main className="flex-1 p-4 pb-28 overflow-y-auto space-y-4">
        {/* On-chain section */}
        {publicKey ? (
          chainSlips && chainSlips.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
                On-Chain Bets
              </div>
              {chainSlips.map((slip) => (
                <OnChainSlipCard key={slip.slipId.toString()} slip={slip} />
              ))}
            </div>
          ) : chainLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
              <span className="text-sm text-muted-foreground">
                Loading on-chain bets…
              </span>
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No on-chain bets found for your wallet.
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-border/40 bg-card/50 p-5 flex flex-col items-center gap-3">
            <Wallet className="w-8 h-8 text-muted-foreground opacity-60" />
            <div className="text-center">
              <div className="text-sm font-bold mb-1">
                Connect wallet to see on-chain bets
              </div>
              <div className="text-xs text-muted-foreground">
                Your Solana wallet holds your bet slips on devnet.
              </div>
            </div>
            <Button size="sm" onClick={() => openWalletModal(true)}>
              <Wallet className="w-4 h-4 mr-1.5" />
              Connect Wallet
            </Button>
          </div>
        )}

        {/* Off-chain section */}
        {restSlips && restSlips.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">
              Off-Chain Bets
            </div>
            {restSlips.map((slip) => {
              const isResolved = slip.status !== "open";
              return (
                <Card
                  key={slip.id}
                  className={cn(
                    "p-4 border-border/50 transition-colors",
                    isResolved
                      ? "cursor-pointer hover:bg-secondary/40 active:bg-secondary/60"
                      : "bg-card/50"
                  )}
                  onClick={() =>
                    isResolved && setLocation(`/result/${slip.id}`)
                  }
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">
                        {slip.market_type.replace("_", " ")}
                      </div>
                      <div className="text-base font-bold text-foreground">
                        {slip.outcome_label}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "uppercase text-[10px] tracking-widest font-bold border-transparent",
                        statusColor(slip.status === "open" ? "active" : slip.status)
                      )}
                    >
                      {slip.status}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border/50">
                    <div>
                      <div className="text-xs text-muted-foreground mb-0.5">
                        Stake
                      </div>
                      <div className="font-mono text-sm">
                        {formatSol(slip.stake_sol)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground mb-0.5">
                        {slip.status === "won" ? "Payout" : "Potential"}
                      </div>
                      <div
                        className={cn(
                          "font-mono text-sm font-bold",
                          slip.status === "won"
                            ? "text-success"
                            : "text-primary"
                        )}
                      >
                        {formatSol(
                          slip.status === "won" && slip.actual_payout
                            ? slip.actual_payout
                            : slip.potential_payout
                        )}
                      </div>
                    </div>
                    {isResolved && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !hasAnyBets && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
            <Inbox className="w-12 h-12 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium mb-1">No bets yet</p>
              <p className="text-xs opacity-70">
                Place your first bet on the market
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation("/")}
            >
              Browse Markets
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
