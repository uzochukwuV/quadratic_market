"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-rich-black">
      {/* ── HERO SECTION ─────────────────────────────────────── */}
      <section className="min-h-[calc(100vh-56px)] flex items-center justify-center border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20 md:py-24 text-center">
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-cadmium-green/10 border border-cadmium-green/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cadmium-green pulse-dot" />
              <span className="font-mono text-caption text-cadmium-green uppercase tracking-widest">
                Solana Prediction Markets
              </span>
            </div>

            <h1 className="text-display md:text-5xl lg:text-6xl text-white font-medium tracking-tight mb-6 leading-tight">
              Trade the Future, <br className="hidden sm:block" />
              Settle the Truth
            </h1>

            <p className="text-body md:text-subheading text-silver-text max-w-2xl mx-auto mb-10 leading-relaxed">
              Quadratic Market brings prediction markets to Solana with fair prices, zero intermediaries, and instant settlement. Trade on any outcome. Earn as a liquidity provider.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="btn-primary px-8 py-4 text-body font-medium whitespace-nowrap"
            >
              Launch App
            </Link>
            <Link
              href="/liquidity"
              className="btn-secondary px-8 py-4 text-body font-medium whitespace-nowrap"
            >
              Provide Liquidity
            </Link>
          </div>

          <p className="text-caption text-silver-text mt-8">
            Non-custodial • Fully decentralized • Instant Solana settlement
          </p>
        </div>
      </section>

      {/* ── VALUE PROPOSITION ─────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: "⚡",
                title: "Fixed Odds",
                desc: "Fixed odds are set per market and updated before kickoff. No AMM curve or slippage model.",
              },
              {
                icon: "🔓",
                title: "Fully Decentralized",
                desc: "Self-custodial trading. Your keys, your assets. No platform risk, no third-party risk.",
              },
              {
                icon: "⚙️",
                title: "Instant Settlement",
                desc: "Settle on Solana. Claim winnings immediately when markets close. No waiting for oracles.",
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-6 rounded-xl border border-graphite bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-subheading text-white font-medium mb-2">{item.title}</h3>
                <p className="text-body text-silver-text leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="mb-16">
            <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
              Getting Started
            </p>
            <h2 className="text-heading md:text-display text-white font-medium">
              How It Works
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                step: "01",
                title: "Connect Wallet",
                desc: "Link your Phantom, Backpack, or Solflare wallet in one click. Non-custodial and secure.",
              },
              {
                step: "02",
                title: "Browse Sports Markets",
                desc: "Explore live sports markets with on-chain odds, market depth, and epoch timing.",
              },
              {
                step: "03",
                title: "Place Your Trade",
                desc: "Buy YES or NO shares at any size. Market or limit orders. Instant execution on Solana.",
              },
              {
                step: "04",
                title: "Claim Your Winnings",
                desc: "When markets settle, claim your profits instantly. Or become an LP and earn trading fees.",
              },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="absolute -top-8 left-0 text-5xl font-bold text-graphite/40">
                  {item.step}
                </div>
                <div className="card pt-8">
                  <h3 className="text-body text-white font-medium mb-2">{item.title}</h3>
                  <p className="text-caption text-silver-text leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── KEY CONCEPTS ──────────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="mb-12">
            <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
              Protocol Mechanics
            </p>
            <h2 className="text-heading md:text-display text-white font-medium">
              Built on Smart Technology
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                title: "Slip-Based Bets",
                desc: "Slips record the match legs and defer pricing until execution time, so odds can update before kickoff.",
              },
              {
                title: "Epoch-Based Markets",
                desc: "Sports markets are organized into epochs. Each epoch contains multiple matches, simplifying portfolio management and LP strategy.",
              },
              {
                title: "Liquidity Pools",
                desc: "Provide liquidity to earn a portion of trading fees. Your capital is deployed across all outcomes proportionally, mitigating impermanent loss.",
              },
              {
                title: "Oracle Settlement",
                desc: "Markets settle via decentralized oracles. No single point of failure. Cryptographic proofs ensure accurate price feeds and immutable resolution.",
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-6 rounded-xl border border-graphite bg-white/[0.02]"
              >
                <h3 className="text-subheading text-white font-medium mb-3">{item.title}</h3>
                <p className="text-body text-silver-text leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECURITY & TRUST ──────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="mb-12">
            <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
              Trust & Safety
            </p>
            <h2 className="text-heading md:text-display text-white font-medium">
              Built for Security
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: "🔐",
                title: "Non-Custodial",
                points: [
                  "Your keys control your assets",
                  "Smart contracts hold funds, not a platform",
                  "Transparent on-chain transactions",
                ],
              },
              {
                icon: "✓",
                title: "Audited Contracts",
                points: [
                  "Code reviewed by security experts",
                  "Public open-source repositories",
                  "Regular security audits and bug bounties",
                ],
              },
              {
                icon: "⚖️",
                title: "Fair Markets",
                points: [
                  "No front-running or MEV attacks",
                  "Odds update before start",
                  "Decentralized price discovery",
                ],
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-6 rounded-xl border border-graphite bg-white/[0.02]"
              >
                <div className="text-3xl mb-4">{item.icon}</div>
                <h3 className="text-subheading text-white font-medium mb-4">{item.title}</h3>
                <ul className="space-y-2">
                  {item.points.map((point, i) => (
                    <li key={i} className="flex items-start gap-3 text-body text-silver-text">
                      <span className="text-cadmium-green flex-shrink-0 mt-0.5">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── USE CASES ────────────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="mb-12">
            <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
              Opportunities
            </p>
            <h2 className="text-heading md:text-display text-white font-medium">
              Trade What Interests You
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { category: "Match Winner", example: "Will Arsenal beat Liverpool at home?" },
              { category: "Totals", example: "Will the game finish over 2.5 goals?" },
              { category: "Both Teams", example: "Will both teams score in the match?" },
              { category: "Handicap", example: "Will the underdog cover the spread?" },
              { category: "First Half", example: "Will there be a first-half goal?" },
              { category: "Correct Score", example: "Will the match end 2-1?" },
            ].map((item, idx) => (
              <div
                key={idx}
                className="p-6 rounded-xl border border-graphite bg-white/[0.02] hover:border-cadmium-green/50 transition-colors"
              >
                <h3 className="text-subheading text-cadmium-green font-medium mb-2">
                  {item.category}
                </h3>
                <p className="text-body text-silver-text">{item.example}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LIQUIDITY PROVIDERS ───────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
                For LPs
              </p>
              <h2 className="text-heading md:text-display text-white font-medium mb-6">
                Earn Yield on Capital
              </h2>
              <p className="text-body text-silver-text mb-6 leading-relaxed">
                Provide liquidity to Quadratic Market and earn a percentage of all trading fees. Your capital is deployed proportionally across outcomes, minimizing impermanent loss.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  "Earn trading fees from all markets in a pool",
                  "Balanced exposure across outcomes",
                  "Flexible deposit and withdrawal",
                  "Real-time fee tracking and APY",
                ].map((point, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-body text-silver-text">
                    <span className="text-cadmium-green flex-shrink-0 mt-1">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/liquidity"
                className="btn-primary px-6 py-3 text-body font-medium inline-block"
              >
                Start Providing Liquidity →
              </Link>
            </div>
            <div className="bg-white/[0.02] border border-graphite rounded-xl p-8">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-silver-text text-body">Total Pool Value</span>
                  <span className="text-white font-mono font-bold text-subheading">$2.8M</span>
                </div>
                <div className="h-px bg-graphite" />
                <div className="flex justify-between items-center">
                  <span className="text-silver-text text-body">Average APY</span>
                  <span className="text-cadmium-green font-mono font-bold text-subheading">24.5%</span>
                </div>
                <div className="h-px bg-graphite" />
                <div className="flex justify-between items-center">
                  <span className="text-silver-text text-body">24h Trading Volume</span>
                  <span className="text-white font-mono font-bold text-body">$145K</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="border-b border-graphite">
        <div className="max-w-content mx-auto px-6 py-20">
          <div className="mb-12">
            <p className="text-caption font-mono text-cadmium-green uppercase tracking-widest mb-4">
              Questions
            </p>
            <h2 className="text-heading md:text-display text-white font-medium">
              Frequently Asked
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                q: "How do I start trading?",
                a: "Connect your Solana wallet, browse markets, and place a trade. Execution is instant and settlement happens on-chain.",
              },
              {
                q: "What is the minimum trade size?",
                a: "There is no minimum. Trade as little as $1 or as much as you want. No hidden fees.",
              },
              {
                q: "How are markets resolved?",
                a: "Markets are resolved by decentralized oracles. Once an outcome is confirmed, winners can claim their payout immediately.",
              },
              {
                q: "Can I lose money?",
                a: "Yes. Prediction markets are risky. You can lose your entire investment. Trade responsibly and within your risk tolerance.",
              },
              {
                q: "What are the fees?",
                a: "A small trading fee (0.5%) is collected from winners. LPs earn these fees proportional to their liquidity provided.",
              },
              {
                q: "Is my money safe?",
                a: "Your funds are self-custodial and held in audited smart contracts. You control your private keys. Not your keys, not your coins.",
              },
            ].map((item, idx) => (
              <div key={idx} className="p-6 rounded-xl border border-graphite bg-white/[0.02]">
                <h3 className="text-body text-white font-medium mb-3">{item.q}</h3>
                <p className="text-caption text-silver-text leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ─────────────────────────────────────────── */}
      <section>
        <div className="max-w-content mx-auto px-6 py-20 text-center">
          <h2 className="text-heading md:text-display text-white font-medium mb-6">
            Ready to Trade?
          </h2>
          <p className="text-body text-silver-text max-w-xl mx-auto mb-8 leading-relaxed">
            Join thousands of traders and liquidity providers on Quadratic Market. Start with markets you understand.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/markets"
              className="btn-primary px-8 py-4 text-body font-medium whitespace-nowrap"
            >
              Explore Markets
            </Link>
            <Link
              href="/epochs"
              className="btn-secondary px-8 py-4 text-body font-medium whitespace-nowrap"
            >
              View Epochs
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="border-t border-graphite py-8">
        <div className="max-w-content mx-auto px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-cadmium-green" />
            <span className="font-mono text-caption text-silver-text">
              Quadratic Market · Solana
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">
              Docs
            </a>
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">
              GitHub
            </a>
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">
              Twitter
            </a>
            <a href="#" className="font-mono text-caption text-silver-text hover:text-white transition-colors">
              Discord
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
