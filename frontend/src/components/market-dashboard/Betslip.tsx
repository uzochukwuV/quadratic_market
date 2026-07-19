"use client";

import type { Pick, SlipMode } from "./types";
import { currency, Icon, marketLabel } from "./Icon";

export function Betslip({
  picks,
  stake,
  setStake,
  totalOdds,
  potentialReturn,
  slipMode,
  setSlipMode,
  remove,
  clear,
  placeBet,
  placing = false,
  canPlace = false,
  placeError = "",
  signature = "",
  className = "",
}: {
  picks: Pick[];
  stake: string;
  setStake: (stake: string) => void;
  totalOdds: number;
  potentialReturn: number;
  slipMode: SlipMode;
  setSlipMode: (mode: SlipMode) => void;
  remove: (id: string) => void;
  clear: () => void;
  placeBet: () => void;
  placing?: boolean;
  canPlace?: boolean;
  placeError?: string;
  signature?: string;
  className?: string;
}) {
  return (
    <aside className={`betslip ${className}`}>
      <div className="slip-head">
        <div>
          <Icon name="ticket" />
          <b>Betslip</b>
          {picks.length > 0 && <span>{picks.length}</span>}
        </div>
        {picks.length > 0 && <button onClick={clear}><Icon name="trash" size={15} /> Clear</button>}
      </div>

      {picks.length === 0 ? (
        <div className="empty-slip">
          <div className="empty-icon"><Icon name="ticket" size={28} /></div>
          <h2>No selections</h2>
          <p>Tap an odds cell to build a slip.</p>
        </div>
      ) : (
        <>
          <div className="slip-type">
            <button onClick={() => setSlipMode("multiple")} className={slipMode === "multiple" ? "active" : ""}>Multiple</button>
            <button onClick={() => setSlipMode("singles")} className={slipMode === "singles" ? "active" : ""}>Singles</button>
          </div>

          <div className="pick-list">
            {picks.map((pick) => (
              <div className="pick" key={pick.outcome.id}>
                <button onClick={() => remove(pick.outcome.id)} aria-label={`Remove ${pick.outcome.label}`}><Icon name="x" size={14} /></button>
                <div>
                  <small>{marketLabel(pick.outcome.marketKey)} · #{pick.fixture.code}</small>
                  <b>{pick.outcome.label}</b>
                  <span>{pick.fixture.home} <i>vs</i> {pick.fixture.away}</span>
                </div>
                <strong>{pick.outcome.odds.toFixed(2)}</strong>
              </div>
            ))}
          </div>

          <div className="slip-status">
            <div>
              <span>Selections</span>
              <b>{picks.length}</b>
            </div>
            <div>
              <span>Market rule</span>
              <b>One pick per market</b>
            </div>
          </div>

          <div className="totals">
            <div>
              <span>{slipMode === "multiple" ? "Total odds" : "Combined singles"}</span>
              <b>{slipMode === "multiple" ? totalOdds.toFixed(2) : picks.length}</b>
            </div>
            <label>
              <span>Stake</span>
              <div>
                <i>N</i>
                <input inputMode="numeric" value={stake} onChange={(event) => setStake(event.target.value.replace(/\D/g, ""))} />
              </div>
            </label>
            <div className="return">
              <span>Potential return</span>
              <b>{currency(potentialReturn)}</b>
            </div>
          </div>

          <button className="place-bet" onClick={placeBet} disabled={!canPlace || placing}>
            {placing ? "Placing bet" : "Place bet"}
          </button>
          {placeError && <p className="wallet-note error">{placeError}</p>}
          {signature && <p className="wallet-note success">Slip awaited: {signature.slice(0, 10)}...</p>}
          <p className="wallet-note">Wallet required before submission.</p>
        </>
      )}
    </aside>
  );
}
