"use client";

import Link from "next/link";

import { useProtocol } from "@/hooks/useProtocol";

function formatAmount(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function epochStatus(epoch: { start_time: number; end_time: number; withdrawals_enabled: boolean; all_markets_settled: boolean }) {
  if (epoch.all_markets_settled) return "Settled";
  if (epoch.withdrawals_enabled) return "Withdrawals open";
  const now = Math.floor(Date.now() / 1000);
  return now >= epoch.start_time && now < epoch.end_time ? "Active" : "Queued";
}

export default function LiquidityPage() {
  const { epochs, epochVaults, epochLpPositions, pendingLiquidity, withdrawals, loading } = useProtocol();

  const totalVaultDeposits = epochVaults.reduce((sum, vault) => sum + vault.total_deposits, 0);
  const totalVaultWithdrawals = epochVaults.reduce((sum, vault) => sum + vault.total_withdrawals, 0);
  const totalShares = epochVaults.reduce((sum, vault) => sum + vault.total_shares, 0);
  const activeVaults = epochVaults.filter((vault) => vault.withdrawals_enabled);
  const nextEpoch = epochs[0];

  return (
    <div className="min-h-screen bg-rich-black">
      <div className="border-b border-graphite bg-[radial-gradient(circle_at_top,_rgba(160,224,171,0.12),_transparent_36%),linear-gradient(180deg,_rgba(255,255,255,0.03),_transparent)]">
        <div className="max-w-content mx-auto px-4 sm:px-6 py-10 sm:py-12">
          <div className="flex flex-col gap-6">
            <div className="max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-silver-text mb-3">Epoch liquidity</p>
              <h1 className="text-heading md:text-display text-white font-medium leading-tight">
                Liquidity managed per epoch.
              </h1>
              <p className="text-body text-silver-text mt-3 max-w-2xl">
                The protocol now treats liquidity as an epoch-scoped pool. Deposits, shares, and withdrawals are tracked around the active sports cycle instead of a global pool.
              </p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Vault deposits</p>
                <p className="text-lg font-semibold text-white mt-1">{formatAmount(totalVaultDeposits)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Withdrawals</p>
                <p className="text-lg font-semibold text-white mt-1">{formatAmount(totalVaultWithdrawals)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Shares</p>
                <p className="text-lg font-semibold text-white mt-1">{formatAmount(totalShares)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Active vaults</p>
                <p className="text-lg font-semibold text-white mt-1">{activeVaults.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-content mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_360px]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-subheading text-white font-medium">Epoch vaults</h2>
                  <p className="text-caption text-silver-text mt-1">Current epoch state and liquidity totals.</p>
                </div>
                <Link href="/markets" className="btn-secondary text-caption">
                  View markets
                </Link>
              </div>

              <div className="space-y-3">
                {epochVaults.length === 0 ? (
                  <p className="text-caption text-silver-text">No epoch vaults are initialized yet.</p>
                ) : (
                  epochVaults.map((vault) => {
                    const epoch = epochs.find((entry) => entry.epoch_id === vault.epoch_id);
                    return (
                      <div key={vault.epoch_id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="badge badge-live">{epochStatus({
                                start_time: epoch?.start_time ?? 0,
                                end_time: epoch?.end_time ?? 0,
                                withdrawals_enabled: vault.withdrawals_enabled,
                                all_markets_settled: Boolean(epoch?.all_markets_settled),
                              })}</span>
                              <span className="badge">Epoch #{vault.epoch_id}</span>
                            </div>
                            <h3 className="text-white font-medium">Vault #{vault.epoch_id}</h3>
                            <p className="text-caption text-silver-text mt-1">
                              {epoch ? `Starts ${new Date(epoch.start_time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Epoch metadata unavailable"}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Deposits</p>
                              <p className="text-white font-semibold mt-1">{formatAmount(vault.total_deposits)}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Withdrawals</p>
                              <p className="text-white font-semibold mt-1">{formatAmount(vault.total_withdrawals)}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Shares</p>
                              <p className="text-white font-semibold mt-1">{formatAmount(vault.total_shares)}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">LPs</p>
                              <p className="text-white font-semibold mt-1">{vault.num_lps}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h2 className="text-subheading text-white font-medium mb-4">Your liquidity state</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Pending deposits</p>
                  <p className="text-white text-xl font-semibold mt-1">{pendingLiquidity.length}</p>
                  <p className="text-caption text-silver-text mt-1">Awaiting activation for the next epoch.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Withdrawal requests</p>
                  <p className="text-white text-xl font-semibold mt-1">{withdrawals.length}</p>
                  <p className="text-caption text-silver-text mt-1">Queued by epoch cooldown.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-silver-text">Epoch LP positions</p>
                  <p className="text-white text-xl font-semibold mt-1">{epochLpPositions.length}</p>
                  <p className="text-caption text-silver-text mt-1">Wallet-owned positions on chain.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 sticky top-20">
              <h3 className="text-body font-medium text-white mb-3">Liquidity notes</h3>
              <div className="space-y-3 text-caption text-silver-text">
                <p>Liquidity is epoch-bound. There is no global pool view in the UI anymore.</p>
                <p>Withdrawals only become available when the epoch flag is enabled on chain.</p>
                <p>Use the markets board to see which fixtures are currently consuming the pool.</p>
              </div>

              <div className="mt-5 grid gap-2">
                <Link href="/markets" className="btn-primary text-center">
                  Browse markets
                </Link>
                <Link href="/portfolio" className="btn-secondary text-center">
                  Open portfolio
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <h3 className="text-body font-medium text-white mb-3">Latest epoch</h3>
              {nextEpoch ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-silver-text text-caption">Epoch</span>
                    <span className="text-white font-mono">#{nextEpoch.epoch_id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-silver-text text-caption">Markets</span>
                    <span className="text-white font-mono">{nextEpoch.num_markets}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-silver-text text-caption">Settled</span>
                    <span className="text-white font-mono">{nextEpoch.num_settled_markets}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-silver-text text-caption">Status</span>
                    <span className="text-cadmium-green font-mono">{nextEpoch.withdrawals_enabled ? "Withdrawals open" : "In play"}</span>
                  </div>
                </div>
              ) : (
                <p className="text-caption text-silver-text">{loading ? "Loading epoch data..." : "No epoch data found."}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
