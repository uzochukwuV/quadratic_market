"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState, useEffect } from "react";
import { useBetSlip } from "./BetSlipDrawer";

const NAV_LINKS = [
  { label: "Markets",   href: "/markets"   },
  { label: "Trade",     href: "/trade"     },
  { label: "Account",   href: "/user"      },
  { label: "Liquidity", href: "/liquidity" },
];

export function Navbar({ onSlipOpen }: { onSlipOpen?: () => void }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { items } = useBetSlip();

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-xl border-b border-white/[0.05]" />

      <div className="relative h-full max-w-[1078px] mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-6 h-6 rounded-full gradient-bg" />
          <span className="text-[14px] font-semibold tracking-tight text-white hidden sm:block">
            Quadratic<span className="text-whisper-gray font-light">.market</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0.5">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 text-[13px] rounded-pill transition-all duration-150 ${
                  active
                    ? "text-white bg-white/[0.08]"
                    : "text-whisper-gray hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Network badge */}
          <span className="hidden sm:flex items-center gap-1.5 px-3 py-1 text-[11px] text-whisper-gray border border-white/[0.07] rounded-pill">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a0e0ab] animate-pulse" />
            Devnet
          </span>

          {/* Bet slip button */}
          <button
            onClick={onSlipOpen}
            className="relative flex items-center gap-2 px-3 py-2 rounded-pill border border-white/[0.1] text-whisper-gray hover:text-white hover:border-white/20 hover:bg-white/[0.04] transition-all"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4.5 5.5h6M4.5 7.5h6M4.5 9.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            <span className="text-[12px] font-medium hidden sm:block">Slip</span>
            {items.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full gradient-bg text-[10px] font-bold text-black flex items-center justify-center">
                {items.length}
              </span>
            )}
          </button>

          {/* Wallet — always visible, no truncation on desktop */}
          <WalletMultiButton />

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 text-whisper-gray hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              {menuOpen ? (
                <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-[#0a0a0a] border-b border-white/[0.06] py-3 px-6 flex flex-col">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`py-3 text-[15px] border-b border-white/[0.04] last:border-0 transition-colors ${active ? "text-white font-semibold" : "text-whisper-gray hover:text-white"}`}
              >
                {link.label}
              </Link>
            );
          })}
          {/* Wallet connect in mobile menu */}
          <div className="pt-3">
            <WalletMultiButton />
          </div>
        </div>
      )}
    </nav>
  );
}
