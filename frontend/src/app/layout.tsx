"use client";

import { useState } from "react";
import { AppWalletProvider } from "@/app/components/AppWalletProvider";
import { Navbar } from "@/app/components/Navbar";
import { EpochBanner } from "@/app/components/EpochBanner";
import { BetSlipDrawer } from "@/app/components/BetSlipDrawer";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [slipOpen, setSlipOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <title>Quadratic Market — Solana Prediction Markets</title>
        <meta name="description" content="Trade prediction markets on Solana. AMM-powered, LMSR-priced, fully decentralized." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppWalletProvider>
          <Navbar onSlipOpen={() => setSlipOpen(true)} />
          <EpochBanner />
          <div className="pt-[calc(64px+40px)]">
            {children}
          </div>
          <BetSlipDrawer open={slipOpen} onClose={() => setSlipOpen(false)} />
        </AppWalletProvider>
      </body>
    </html>
  );
}
