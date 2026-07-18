"use client";

import { useState } from "react";
import { AppWalletProvider } from "@/app/components/AppWalletProvider";
import { Navbar } from "@/app/components/Navbar";
import { BetSlipDrawer } from "@/app/components/BetSlipDrawer";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [slipOpen, setSlipOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <title>Quadratic Market — Sportsbook Board</title>
        <meta name="description" content="Sports-first markets on Solana with fixed odds, grouped fixtures, and epoch liquidity." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppWalletProvider>
          <Navbar onSlipOpen={() => setSlipOpen(true)} />
          <div className="pt-16">
            {children}
          </div>
          <BetSlipDrawer open={slipOpen} onClose={() => setSlipOpen(false)} />
        </AppWalletProvider>
      </body>
    </html>
  );
}
