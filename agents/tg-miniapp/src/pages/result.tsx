import { useRoute, useLocation } from "wouter";
import { useGetSlip } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatSol, cn } from "@/lib/utils";
import { Trophy, Frown, Share2, ArrowLeft, Loader2 } from "lucide-react";

export default function Result() {
  const [, params] = useRoute("/result/:id");
  const [, setLocation] = useLocation();
  const slipId = params?.id ? parseInt(params.id, 10) : null;

  const { data: slip, isLoading } = useGetSlip(slipId as number, {
    query: { enabled: !!slipId, queryKey: ['/api/slips', slipId] }
  });

  const handleShare = () => {
    // @ts-ignore
    const tg = window.Telegram?.WebApp;
    if (tg?.switchInlineQuery) {
      const outcome = slip?.status === 'won' ? 'WON' : 'played';
      const text = `I just ${outcome} ${formatSol(slip?.stake_sol || 0)} on ${slip?.home_team} vs ${slip?.away_team}!`;
      tg.switchInlineQuery(text, ['choose_chat']);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!slip || slip.status === 'open') {
    return (
      <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground items-center justify-center p-4 text-center">
        <p className="text-muted-foreground mb-4">Slip not found or not resolved yet.</p>
        <Button onClick={() => setLocation("/positions")}>Go Back</Button>
      </div>
    );
  }

  const isWin = slip.status === 'won';

  return (
    <div className="flex flex-col min-h-dvh max-w-[430px] mx-auto bg-background text-foreground relative">

      <main className="flex-1 p-6 pb-24 flex flex-col items-center justify-center text-center">

        <div className={cn(
          "w-24 h-24 rounded-full flex items-center justify-center mb-8 shadow-2xl",
          isWin ? "bg-success/20 text-success shadow-success/20" : "bg-secondary text-muted-foreground"
        )}>
          {isWin ? <Trophy className="w-12 h-12" /> : <Frown className="w-12 h-12" />}
        </div>

        <h1 className={cn(
          "text-3xl font-black tracking-tighter uppercase mb-2",
          isWin ? "text-success" : "text-muted-foreground"
        )}>
          {isWin ? "You Won!" : "Better Luck Next Time"}
        </h1>

        <div className="text-lg font-bold mb-8">
          {slip.home_team} 2 - 1 {slip.away_team}
        </div>

        <Card className="w-full p-6 bg-secondary/30 border-border/50 backdrop-blur text-left">
          <div className="mb-4 pb-4 border-b border-border/50">
            <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">
              {slip.market_type.replace('_', ' ')}
            </div>
            <div className="text-xl font-bold text-foreground">
              {slip.outcome_label}
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-muted-foreground">Stake</div>
            <div className="font-mono text-sm font-medium">{formatSol(slip.stake_sol)}</div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-foreground">Payout</div>
            <div className={cn(
              "font-mono text-lg font-bold",
              isWin ? "text-success" : "text-muted-foreground"
            )}>
              {formatSol(slip.actual_payout || 0)}
            </div>
          </div>
        </Card>

      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 pb-8 bg-gradient-to-t from-background via-background/95 to-transparent backdrop-blur-[2px] z-20 max-w-[430px] mx-auto space-y-3">
        <Button
          size="lg"
          className="w-full h-14 text-sm font-bold tracking-wide uppercase bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={handleShare}
        >
          <Share2 className="w-4 h-4 mr-2" />
          Share to Chat
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="w-full h-14 text-sm font-bold tracking-wide uppercase text-muted-foreground hover:text-foreground"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Markets
        </Button>
      </div>

    </div>
  );
}
