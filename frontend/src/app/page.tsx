"use client";

import Link from "next/link";
import { Ticker } from "./components/Ticker";
import { StatBadge } from "./components/StatBadge";
import { MarketCard } from "./components/MarketCard";
import { MARKETS } from "@/lib/mockData";

const FEATURED = MARKETS.filter((m) => m.status === "Open").slice(0, 6);

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect Wallet",
    body: "Link your Solana wallet (Phantom, Backpack, Solflare) in one click. No sign-up, no KYC.",
    color: "#a0e0ab",
  },
  {
    step: "02",
    title: "Pick a Market",
    body: "Browse events across sports, finance, crypto and politics. Each market resolves on-chain via a trusted oracle.",
    color: "#ffac2e",
  },
  {
    step: "03",
    title: "Buy YES or NO",
    body: "LMSR automated market making sets fair prices in real time. Buy at any size — instant settlement.",
    color: "#a52d25",
  },
  {
    step: "04",
    title: "Collect Winnings",
    body: "When the oracle settles the market, claim your share directly to your wallet. Fully non-custodial.",
    color: "#a07bff",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* ── HERO ──────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-16">
        <div className="absolute inset-0">
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background:
                "linear-gradient(135deg, rgba(160,224,171,0.15) 0%, rgba(255,172,46,0.10) 50%, rgba(165,45,37,0.12) 100%)",
            }}
          />
          <div className="orb w-[600px] h-[600px] -top-32 -left-32" style={{ background: "rgb(160,224,171)" }} />
          <div className="orb w-[500px] h-[500px] top-1/4 right-0"   style={{ background: "rgb(255,172,46)" }} />
          <div className="orb w-[400px] h-[400px] bottom-0 left-1/3" style={{ background: "rgb(165,45,37)" }} />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />
        </div>

        <div className="relative z-10 max-w-[1078px] mx-auto px-6 py-24">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-pill border border-white/[0.12] bg-white/[0.04] backdrop-blur-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-[#a0e0ab] animate-pulse" />
            <span className="text-[12px] text-whisper-gray">Live on Solana Devnet</span>
          </div>

          <h1 className="text-[54px] md:text-[78px] font-semibold leading-[0.95] tracking-tight text-white mb-6 max-w-4xl">
            Predict the future.
            <br />
            <span className="gradient-text">Trade anything.</span>
          </h1>

          <p className="text-[18px] text-whisper-gray max-w-xl leading-relaxed mb-10">
            The first AMM-based prediction market on Solana. LMSR pricing, instant settlement, zero counterparty risk.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/markets"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-pill bg-white text-black text-[15px] font-semibold hover:bg-white/90 transition-all duration-200 hover:scale-[1.02]"
            >
              Explore Markets
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href="/liquidity"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-pill border border-white/[0.18] text-white text-[15px] font-light hover:bg-white/[0.06] transition-all duration-200"
            >
              Provide Liquidity
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-8 mt-14 pt-10 border-t border-white/[0.06]">
            {[
              { label: "Total Volume",  value: "$14.2M"  },
              { label: "Open Markets",  value: "48"      },
              { label: "Traders",       value: "3,200+"  },
              { label: "Avg. Spread",   value: "1.2¢"   },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-[29px] font-semibold text-white">{s.value}</p>
                <p className="text-[12px] text-whisper-gray mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TICKER ────────────────────────────────────────────── */}
      <Ticker />

      {/* ── FEATURED MARKETS ──────────────────────────────────── */}
      <section className="max-w-[1078px] mx-auto px-6 py-24">
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-2">Live now</p>
            <h2 className="text-[39px] font-semibold text-white leading-tight">Featured Markets</h2>
          </div>
          <Link
            href="/markets"
            className="hidden sm:inline-flex items-center gap-2 px-6 py-2.5 rounded-pill border border-white/[0.18] text-white text-[14px] hover:bg-white/[0.06] transition-colors"
          >
            All markets
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7h9M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[14px]">
          {FEATURED.map((market) => (
            <MarketCard key={market.market_id} market={market} />
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{ background: "linear-gradient(90deg, rgb(160,224,171), rgb(255,172,46) 50%, rgb(165,45,37))" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />

        <div className="relative max-w-[1078px] mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-3">Simple by design</p>
            <h2 className="text-[39px] font-semibold text-white">How it works</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px]">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.step} className="glass-card rounded-card p-8">
                <p className="text-[54px] font-semibold leading-none mb-4 opacity-20" style={{ color: step.color }}>
                  {step.step}
                </p>
                <h3 className="text-[18px] font-semibold mb-3" style={{ color: step.color }}>
                  {step.title}
                </h3>
                <p className="text-[14px] text-whisper-gray leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROTOCOL STATS ────────────────────────────────────── */}
      <section className="max-w-[1078px] mx-auto px-6 py-24">
        <p className="text-[12px] text-whisper-gray uppercase tracking-widest mb-3">Protocol</p>
        <h2 className="text-[39px] font-semibold text-white mb-10">By the numbers</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-[14px]">
          <StatBadge label="Total Volume"  value="$14.2M" sub="All-time"       accent="green" />
          <StatBadge label="Open Interest" value="$2.8M"  sub="Locked"         accent="amber" />
          <StatBadge label="Resolved"      value="124"    sub="Markets settled"               />
          <StatBadge label="Avg. Fee"      value="0.5%"   sub="Per trade"                     />
        </div>
      </section>

      {/* ── BLINKS SECTION ────────────────────────────────────── */}
      <section className="max-w-[1078px] mx-auto px-6 pb-24">
        <div className="glass-card rounded-card p-10 md:p-14 flex flex-col md:flex-row gap-12 items-center">
          <div className="flex-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-[#a0e0ab]/10 border border-[#a0e0ab]/25 text-[#a0e0ab] text-[11px] font-semibold mb-5">
              ⚡ Powered by Dialect Blinks
            </span>
            <h2 className="text-[29px] font-semibold text-white mb-4 leading-tight">
              Trade anywhere
              <br />
              <span className="text-whisper-gray font-light">without leaving the context.</span>
            </h2>
            <p className="text-[15px] text-whisper-gray leading-relaxed mb-6">
              Quadratic Market is built on Solana Actions &amp; Blinks — the open standard for shareable blockchain transactions. Embed any market directly into tweets, chats, or dApps.
            </p>
            <a
              href="https://docs.dialect.to/blinks"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] text-white/70 hover:text-white transition-colors"
            >
              Learn about Blinks
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 11L11 3M6 3h5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          <div className="flex-1 w-full space-y-4">
            {[
              { icon: "⚙",  label: "LMSR Automated Market Maker", desc: "Fair pricing at any liquidity depth"      },
              { icon: "🔒", label: "Non-custodial",                desc: "Your keys, your funds, always"            },
              { icon: "⚡", label: "400ms settlement",             desc: "Solana finality, not promises"            },
              { icon: "🌐", label: "Embeddable everywhere",        desc: "One URL = full trading interface"         },
            ].map((f) => (
              <div key={f.label} className="flex items-start gap-4 p-4 rounded-card bg-white/[0.03] border border-white/[0.05]">
                <span className="text-[20px] flex-shrink-0 mt-0.5">{f.icon}</span>
                <div>
                  <p className="text-[14px] font-semibold text-white">{f.label}</p>
                  <p className="text-[12px] text-whisper-gray">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-12">
        <div className="max-w-[1078px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-full gradient-bg" />
            <span className="text-[14px] text-whisper-gray">Quadratic Market · Solana Prediction Protocol</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-[13px] text-whisper-gray hover:text-white transition-colors">GitHub</a>
            <a href="https://docs.dialect.to"  target="_blank" rel="noopener noreferrer" className="text-[13px] text-whisper-gray hover:text-white transition-colors">Docs</a>
            <a href="https://x.com"            target="_blank" rel="noopener noreferrer" className="text-[13px] text-whisper-gray hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
