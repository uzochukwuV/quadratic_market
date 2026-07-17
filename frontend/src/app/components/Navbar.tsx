"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState, useEffect } from "react";
import { useBetSlip } from "./BetSlipDrawer";
import { getNetworkLabel } from "@/lib/env";

const NAV_LINKS = [
  { label: "Markets",   href: "/markets"   },
  { label: "Trade",     href: "/trade"     },
  { label: "Epochs",    href: "/epochs"    },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Liquidity", href: "/liquidity" },
];

export function Navbar({ onSlipOpen }: { onSlipOpen?: () => void }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { items } = useBetSlip();

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-rich-black border-b border-graphite">
      <div className="max-w-content mx-auto px-6 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 flex-shrink-0 h-full">
          <div className="w-5 h-5 rounded-full bg-cadmium-green" />
          <span className="text-body text-white font-medium tracking-tight hidden sm:block">
            Quad<span className="text-silver-text font-normal">.market</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center h-full gap-0">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`h-full px-4 flex items-center text-body transition-all duration-150 font-outfit border-b-2 ${
                  active
                    ? "text-white border-cadmium-green"
                    : "text-silver-text hover:text-white border-transparent hover:border-ash-gray/50"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 h-full">
          {/* Network badge */}
          <span className="hidden sm:flex items-center gap-2 px-3 h-9 text-caption font-mono text-silver-text border border-graphite rounded-full bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-cadmium-green pulse-dot" />
            {getNetworkLabel()}
          </span>

          {/* Bet slip button */}
          <button
            onClick={onSlipOpen}
            className="relative flex items-center gap-2 px-3 h-9 rounded-full border border-graphite text-silver-text hover:text-white hover:border-ash-gray hover:bg-white/[0.02] transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="2" width="11" height="10" rx="1" />
              <path d="M4 5h6M4 7h6M4 9h4" strokeLinecap="round" />
            </svg>
            <span className="text-caption font-mono hidden sm:block">Slip</span>
            {items.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-cadmium-green text-xs font-bold text-true-black flex items-center justify-center">
                {items.length}
              </span>
            )}
          </button>

          {/* Wallet - adjust height */}
          <div className="h-9 flex items-center">
            <WalletMultiButton />
          </div>

          {/* Mobile menu toggle */}
          <button
            className="md:hidden h-9 w-9 flex items-center justify-center text-silver-text hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              {menuOpen ? (
                <path d="M2 2L16 16M16 2L2 16" strokeLinecap="round" />
              ) : (
                <path d="M2 5h14M2 9h14M2 13h14" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-rich-black border-b border-graphite py-3 px-6 flex flex-col">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`py-3 text-body font-mono border-b border-graphite last:border-0 transition-colors ${
                  active ? "text-cadmium-green font-medium" : "text-silver-text hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <div className="pt-3">
            <WalletMultiButton />
          </div>
        </div>
      )}
    </nav>
  );
}
