import type { ReactNode } from "react";

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    ticket: <><path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5Z" /><path d="M9 5v14" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.48M7.76 16.24a6 6 0 0 1 0-8.48M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    ball: <><circle cx="12" cy="12" r="9" /><path d="m9 9 3-2 3 2-1 4h-4L9 9Zm-5 2 5-2m6 0 5 2M10 13l-2 6m6-6 2 6" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    x: <><path d="m6 6 12 12M18 6 6 18" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    wallet: <><path d="M4 7h16v12H4z" /><path d="M16 12h4" /><path d="M6 7V5h11v2" /></>,
    mint: <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}

export function marketLabel(marketKey: "match_result" | "total_goals" | "gg_ng") {
  if (marketKey === "match_result") return "1X2";
  if (marketKey === "total_goals") return "O/U 2.5";
  return "GG/NG";
}

export function currency(value: number) {
  return `N${value.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
