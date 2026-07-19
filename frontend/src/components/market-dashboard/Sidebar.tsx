"use client";

import { Icon } from "./Icon";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="side-title">Sports</div>
      {[
        ["ball", "Football", "42"],
        ["radio", "Live Now", "12"],
        ["clock", "Starting Soon", "18"],
        ["grid", "Basketball", "8"],
      ].map(([icon, label, count]) => (
        <button key={label} className={label === "Football" ? "active" : ""}>
          <Icon name={icon} />
          <span>{label}</span>
          <em>{count}</em>
        </button>
      ))}

      <div className="side-title league-title">Pinned Leagues</div>
      {["Premier League", "Champions League", "La Liga", "Serie A", "Bundesliga"].map((league) => (
        <button className="league-link" key={league}>
          <span>{league}</span>
        </button>
      ))}
    </aside>
  );
}
