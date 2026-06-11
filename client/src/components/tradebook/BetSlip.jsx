import React, { useState, useMemo, useCallback } from "react";
import { X, Trash2, Receipt, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getProtocolConfig, useUserSlips, quoteBuy } from "@/lib/api";
import { buildSlipTransactions, sendAndConfirmAll } from "@/lib/solana";

// USDC has 6 decimals — 1 USDC = 1_000_000 lamports
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

// Stake quick-select amounts in USDC
const QUICK_STAKES_USDC = [1, 5, 10, 50];

const statusColors = {
  Won:       "bg-green-500",
  Lost:      "bg-red-500",
  Open:      "bg-sunset-orange",
  Settled:   "bg-blue-500",
  Voided:    "bg-silver-ash",
  Cancelled: "bg-silver-ash",
};

const statusLabels = {
  Won:       "Won ✓",
  Lost:      "Lost",
  Open:      "Pending",
  Settled:   "Settled",
  Voided:    "Voided",
  Cancelled: "Cancelled",
};

export default function BetSlip({ bets, onRemoveBet, onClearSlip }) {
  const { toast } = useToast();

  // Stake in USDC (whole units, e.g. 10 = 10 USDC)
  const [stake, setStake] = useState(10);
  const [activeTab, setActiveTab] = useState("slip");
  const [placing, setPlacing] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { success, sigs, error }

  // Get connected wallet from Phantom
  const walletPubkey = window.solana?.isConnected
    ? window.solana.publicKey?.toString()
    : null;

  // History from API (open and settled slips for the connected wallet)
  const { data: slipsData } = useUserSlips(walletPubkey, {
    startId: 1, endId: 100, onlyOpen: false,
  });

  // Total odds (product of all leg odds)
  const totalOdds = useMemo(() => {
    if (bets.length === 0) return 1;
    return bets.reduce((acc, bet) => acc * (bet.odds || 1), 1);
  }, [bets]);

  // Max payment with 20% slippage buffer (in lamports)
  const maxPaymentLamports = useMemo(() => {
    const costUsdc = stake;                         // rough USDC cost
    const withSlippage = costUsdc * 1.2;            // +20% buffer
    return Math.ceil(withSlippage * USDC_SCALE);
  }, [stake]);

  // Potential win
  const potentialWin = totalOdds * stake;

  const formatUsdc = (usdc) =>
    usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleStakeInput = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    setStake(raw === "" ? 0 : parseFloat(raw) || 0);
  };

  /**
   * Place Bet:
   *  1. Fetch /protocol_config  (next_slip_id, rpc_url, addresses)
   *  2. Build 3 transactions   (openSlip, addSlipLeg×N, finalizeSlip)
   *  3. Sign all via Phantom   (signAllTransactions — one wallet prompt)
   *  4. Send sequentially      (sendAndConfirmAll)
   */
  const handlePlaceBet = useCallback(async () => {
    if (!walletPubkey) {
      toast({ title: "Wallet not connected", description: "Connect Phantom first." });
      return;
    }
    if (bets.length === 0 || stake <= 0) return;

    // Every bet must have a marketId (from live data) — guard against mock-only bets
    const liveBets = bets.filter((b) => b.marketId != null);
    if (liveBets.length !== bets.length) {
      toast({
        title: "Some selections are demo-only",
        description: "Only on-chain markets can be placed. Remove demo selections.",
        variant: "destructive",
      });
      return;
    }

    setPlacing(true);
    setLastResult(null);

    try {
      // 1. Get protocol config + next_slip_id
      const config = await getProtocolConfig();

      // 2. Build legs — outcomeIndex maps the odds key ("1"/"X"/"2") to 0/1/2
      const legs = liveBets.map((b) => {
        // outcomeIndex is set by OddsTable.handleClick
        const oi = b.outcomeIndex != null ? b.outcomeIndex : 0;
        return {
          marketId: b.marketId,
          outcomeId: oi,
          numShares: Math.floor(stake * USDC_SCALE), // shares = lamports deposited
        };
      });

      // 3. Build transactions
      const txs = await buildSlipTransactions(config, walletPubkey, legs, maxPaymentLamports);

      // 4. Sign all with Phantom (one user prompt for all 3+ txs)
      if (!window.solana?.signAllTransactions) {
        throw new Error("Phantom signAllTransactions not available");
      }
      const signedTxs = await window.solana.signAllTransactions(txs);

      // 5. Send sequentially + confirm
      const sigs = await sendAndConfirmAll(config.rpc_url, signedTxs);

      setLastResult({ success: true, sigs, slipId: config.next_slip_id });
      toast({
        title: "Bet placed! 🎉",
        description: `Slip #${config.next_slip_id} confirmed. Sigs: ${sigs.length}`,
      });
      onClearSlip();
    } catch (err) {
      const msg = err?.message || String(err);
      setLastResult({ success: false, error: msg });
      toast({
        title: "Transaction failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setPlacing(false);
    }
  }, [bets, stake, walletPubkey, maxPaymentLamports, onClearSlip, toast]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <aside className="w-[280px] bg-canvas border-l border-light-pearl shrink-0 flex flex-col sticky top-0 h-[calc(100vh-100px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-inter text-[15px] font-bold text-midnight">Bet Slip</h3>
            {bets.length > 0 && (
              <span className="bg-sunset-orange text-white font-inter text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                {bets.length}
              </span>
            )}
          </div>
          {bets.length > 0 && (
            <button
              onClick={onClearSlip}
              className="flex items-center gap-1 text-silver-ash hover:text-midnight transition-colors"
              title="Clear all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="font-inter text-[12px]">Clear</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-light-pearl">
          {["slip", "history"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-inter text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-midnight text-midnight"
                  : "border-transparent text-silver-ash hover:text-dark-shale"
              }`}
            >
              {tab === "slip" ? "Selections" : (
                <>
                  <Receipt className="w-3.5 h-3.5" />
                  History
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Slip Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "slip" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Selections list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {bets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-12 h-12 rounded-full bg-cloud-whisper flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-silver-ash" />
                </div>
                <p className="font-inter text-[13px] text-silver-ash text-center">
                  Click any odds to<br />add selections
                </p>
              </div>
            ) : (
              bets.map((bet) => (
                <div key={bet.id} className="bg-cloud-whisper rounded-lg p-3 relative group border border-transparent hover:border-light-pearl transition-all">
                  <button
                    onClick={() => onRemoveBet(bet.id)}
                    className="absolute top-2 right-2 text-silver-ash hover:text-midnight opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="font-inter text-[11px] text-silver-ash mb-1 pr-5 truncate">{bet.match}</div>
                  <div className="flex items-center justify-between pr-4">
                    <span className="font-inter text-[13px] font-semibold text-midnight leading-tight">{bet.selection}</span>
                    <span className="font-inter text-[15px] font-bold text-sunset-orange ml-2 shrink-0">
                      {bet.odds != null ? bet.odds.toFixed(2) : "—"}
                    </span>
                  </div>
                  {bet.marketId == null && (
                    <span className="text-[10px] text-silver-ash italic">demo only</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Stake & Payout — always visible at bottom */}
          <div className="shrink-0 border-t border-light-pearl px-4 pt-3 pb-4 space-y-3 bg-canvas">
            {/* Wallet status */}
            {!walletPubkey && (
              <div className="text-[11px] text-silver-ash text-center bg-cloud-whisper rounded px-2 py-1.5">
                Connect wallet to place on-chain bets
              </div>
            )}

            {/* Stake input (USDC) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-inter text-[12px] font-semibold text-dark-shale uppercase tracking-wide">
                  Stake (USDC)
                </label>
                <span className="font-inter text-[12px] text-silver-ash">$</span>
              </div>
              <input
                type="text"
                value={stake === 0 ? "" : stake}
                onChange={handleStakeInput}
                placeholder="Enter USDC amount"
                className="w-full border border-midnight/20 rounded-lg px-3 py-2 font-inter text-[15px] font-semibold text-midnight focus:outline-none focus:border-sunset-orange transition-colors bg-canvas text-right"
              />
            </div>

            {/* Quick stake buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_STAKES_USDC.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setStake(amount)}
                  className={`py-1 rounded font-inter text-[11px] font-medium border transition-all ${
                    stake === amount
                      ? "bg-midnight text-white border-midnight"
                      : "bg-cloud-whisper text-dark-shale border-light-pearl hover:border-silver-ash"
                  }`}
                >
                  ${amount}
                </button>
              ))}
            </div>

            {/* Summary rows */}
            <div className="space-y-1.5 bg-cloud-whisper rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">
                  {bets.length} Selection{bets.length !== 1 ? "s" : ""}
                </span>
                <span className="font-inter text-[12px] font-medium text-dark-shale">
                  {bets.length > 1 ? "Accumulator" : "Single"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">Total Odds</span>
                <span className="font-inter text-[13px] font-bold text-midnight">
                  {bets.length > 0 ? totalOdds.toFixed(2) : "—"}
                </span>
              </div>
              <div className="h-px bg-light-pearl my-1" />
              <div className="flex items-center justify-between">
                <span className="font-inter text-[13px] font-semibold text-dark-shale">Potential Win</span>
                <span className="font-inter text-[15px] font-bold text-midnight">
                  {bets.length > 0 && stake > 0
                    ? `$${formatUsdc(potentialWin)} USDC`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Last result feedback */}
            {lastResult && (
              <div className={`flex items-start gap-2 text-[12px] rounded-lg px-3 py-2 ${
                lastResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {lastResult.success
                  ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                <span>
                  {lastResult.success
                    ? `Slip #${lastResult.slipId} placed! (${lastResult.sigs.length} txns)`
                    : lastResult.error}
                </span>
              </div>
            )}

            {/* Place Bet button */}
            <button
              onClick={handlePlaceBet}
              disabled={bets.length === 0 || stake <= 0 || placing}
              className="w-full bg-sunset-orange text-white font-inter text-[14px] font-bold py-3 rounded-[20px] hover:bg-sunset-orange/90 transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed tracking-wide flex items-center justify-center gap-2"
            >
              {placing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Placing...
                </>
              ) : (
                `PLACE BET — $${stake > 0 ? formatUsdc(stake) : "0.00"} USDC`
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── History Tab ──────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {!walletPubkey ? (
            <p className="font-inter text-[13px] text-silver-ash text-center py-8">
              Connect wallet to see bet history
            </p>
          ) : slipsData?.slips?.length === 0 || !slipsData ? (
            <p className="font-inter text-[13px] text-silver-ash text-center py-8">
              No bets yet
            </p>
          ) : (
            slipsData.slips.map((slip) => (
              <div
                key={slip.slip_id}
                className="bg-cloud-whisper rounded-lg px-3 py-2.5 flex items-center gap-3"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${statusColors[slip.status] || "bg-silver-ash"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-inter text-[13px] font-medium text-midnight">
                    Slip #{slip.slip_id}
                  </div>
                  <div className="font-inter text-[11px] text-silver-ash">
                    {slip.num_legs} leg{slip.num_legs !== 1 ? "s" : ""} •{" "}
                    {statusLabels[slip.status] || slip.status}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-inter text-[13px] font-bold text-midnight">
                    ${(slip.total_stake / USDC_SCALE).toFixed(2)}
                  </div>
                  {slip.status === "Won" && (
                    <div className="font-inter text-[11px] text-green-600 font-semibold">
                      +${(slip.potential_payout / USDC_SCALE).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
