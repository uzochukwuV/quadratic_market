const navItems = ["Product", "Sports", "How it works", "Trust"];

const oddsBoard = [
  { sport: "Premier League", match: "Arsenal vs Chelsea", odds: "+135", status: "Tonight" },
  { sport: "NBA", match: "Lakers vs Warriors", odds: "-110", status: "Live" },
  { sport: "MLB", match: "Mets vs Dodgers", odds: "+102", status: "Tomorrow" },
];

const logos = ["TxLINE", "Solana", "Football", "Basketball", "Soccer", "Baseball"];

const stats = [
  ["1 slip", "Build single picks or combine matches into one bet slip."],
  ["TxLINE", "Odds and sports data help check the result after the match."],
  ["Sports only", "No politics, no meme markets, no unrelated prediction topics."],
];

const sections = [
  {
    label: "Pick",
    number: "01",
    title: "Find the game and choose your side.",
    body: "Markets are organized around real fixtures, teams, start times, and familiar odds. You should not need to decode finance language to place a sports bet.",
    imageTitle: "Match view",
    rows: ["Team form", "Live odds", "Start time"],
  },
  {
    label: "Slip",
    number: "02",
    title: "Review every pick before money moves.",
    body: "Your slip keeps the match, pick, and stake together. If you choose multiple games, the page keeps the payout easy to understand before you place it.",
    imageTitle: "Slip builder",
    rows: ["Stake", "Picks", "Possible payout"],
  },
  {
    label: "Result",
    number: "03",
    title: "TxLINE odds help confirm what happened.",
    body: "When a match ends, the result is checked against TxLINE odds and sports data. Winners get paid from the confirmed outcome, not from a manual guess.",
    imageTitle: "Result check",
    rows: ["Final score", "TxLINE check", "Winner paid"],
  },
];

function ProductMockup() {
  return (
    <div className="relative mx-auto mt-14 max-w-6xl px-5 sm:px-8 lg:px-10">
      <div className="rounded-[32px] border border-white/14 bg-white/[0.06] p-3 shadow-[0_40px_140px_rgba(0,0,0,0.45)]">
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#101316]">
          <div className="grid border-b border-white/10 bg-white/[0.04] px-5 py-4 text-[13px] text-white/58 sm:grid-cols-[1fr_auto]">
            <span>Quadratic Market sportsbook</span>
            <span className="hidden sm:inline">TxLINE odds connected</span>
          </div>
          <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] text-white/58">Featured markets</p>
                <span className="rounded-full bg-[#0b5cff] px-3 py-1 text-[13px] text-white">Live</span>
              </div>
              <div className="grid gap-3">
                {oddsBoard.map((item) => (
                  <div
                    key={item.match}
                    className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-[18px] border border-white/10 bg-white/[0.04] p-4"
                  >
                    <div>
                      <p className="text-[13px] uppercase text-white/44">{item.sport}</p>
                      <p className="mt-1 text-[18px] font-medium text-white">{item.match}</p>
                      <p className="mt-1 text-[14px] text-white/58">{item.status}</p>
                    </div>
                    <button className="rounded-[16px] bg-white px-4 py-3 text-[18px] font-semibold text-[#0b0d10]">
                      {item.odds}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-white/10 bg-white/[0.03] p-4 sm:p-6 lg:border-l lg:border-t-0">
              <p className="text-[15px] text-white/58">Bet slip</p>
              <div className="mt-4 rounded-[18px] border border-white/10 bg-[#0b0d10] p-4">
                <p className="text-[22px] font-medium text-white">2 picks selected</p>
                <div className="mt-5 grid gap-3 text-[15px] text-white/64">
                  <div className="flex justify-between border-b border-white/10 pb-3">
                    <span>Stake</span>
                    <span>$50</span>
                  </div>
                  <div className="flex justify-between border-b border-white/10 pb-3">
                    <span>Odds source</span>
                    <span>TxLINE</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Possible payout</span>
                    <span className="text-white">$142.50</span>
                  </div>
                </div>
              </div>
              <button className="mt-4 w-full rounded-[18px] bg-[#f5ff3d] px-5 py-4 text-[16px] font-semibold text-[#0b0d10]">
                Place slip
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureVisual({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-[28px] bg-[#f4f2ec] p-4">
      <div className="overflow-hidden rounded-[22px] border border-black/10 bg-white">
        <div className="border-b border-black/10 px-5 py-4 text-[14px] text-black/48">{title}</div>
        <div className="grid gap-3 p-5">
          {rows.map((row, index) => (
            <div key={row} className="flex items-center justify-between rounded-[16px] bg-[#f4f2ec] px-4 py-4">
              <span className="text-[16px] text-[#111]">{row}</span>
              <span className="h-3 w-24 rounded-full bg-[#0b5cff]" style={{ opacity: 1 - index * 0.22 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main id="top" className="min-h-screen bg-[#f7f5ef] text-[#0b0d10]">
      <section className="bg-[#080a0d] text-white">
        <div className="border-b border-white/10 bg-[#11151a]">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-5 py-3 text-center text-[14px] text-white/76">
            <span>The sportsbook should never guess.</span>
            <a href="#trust" className="font-medium text-white underline underline-offset-4">
              See how TxLINE odds help check results
            </a>
          </div>
        </div>

        <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
          <a href="#top" className="text-[20px] font-semibold">
            Quadratic Market
          </a>
          <nav className="hidden items-center gap-7 lg:flex">
            {navItems.map((item) => (
              <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="text-[15px] text-white/68">
                {item}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="#how-it-works" className="hidden text-[15px] text-white/68 sm:inline">
              Learn more
            </a>
            <a href="#product" className="rounded-full bg-white px-5 py-2.5 text-[15px] font-semibold text-[#080a0d]">
              View markets
            </a>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 pb-14 pt-16 text-center sm:px-8 sm:pt-20 lg:px-10">
          <p className="mx-auto max-w-fit rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-[13px] uppercase tracking-[1px] text-white/58">
            Sports odds on Solana
          </p>
          <h1 className="mx-auto mt-8 max-w-5xl text-[56px] font-semibold leading-[0.94] sm:text-[82px] lg:text-[112px]">
            Bet with odds, not guesswork
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-[18px] leading-[1.5] text-white/68 sm:text-[20px]">
            Quadratic Market is a sports betting app for real matches, simple slips, and clear result checks.
            Sports odds power the experience, and TxLINE odds help confirm outcomes after games finish.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#product" className="rounded-full bg-[#f5ff3d] px-6 py-3 text-[16px] font-semibold text-[#080a0d]">
              Explore the product
            </a>
            <a href="#how-it-works" className="rounded-full border border-white/18 px-6 py-3 text-[16px] font-semibold text-white">
              How slips work
            </a>
          </div>
        </div>

        <ProductMockup />

        <div className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 lg:px-10">
          <div className="grid grid-cols-2 gap-3 text-center text-[14px] uppercase tracking-[1px] text-white/44 sm:grid-cols-3 lg:grid-cols-6">
            {logos.map((logo) => (
              <div key={logo} className="rounded-full border border-white/10 px-4 py-3">
                {logo}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <p className="max-w-5xl text-[40px] font-semibold leading-[1.05] sm:text-[64px] lg:text-[86px]">
          One place to choose a match, build a slip, and see how the result is checked.
        </p>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {stats.map(([value, text]) => (
            <article key={value} className="rounded-[28px] bg-white p-7">
              <p className="text-[44px] font-semibold leading-none text-[#0b0d10]">{value}</p>
              <p className="mt-5 text-[18px] leading-[1.45] text-black/62">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="sports" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-8 border-t border-black/10 pt-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-[13px] uppercase tracking-[1px] text-black/44">Sports</p>
            <h2 className="mt-6 max-w-xl text-[48px] font-semibold leading-[1.02] sm:text-[72px]">
              Built around real games.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {["Football", "Basketball", "Soccer", "Baseball", "Tennis", "Combat sports"].map((sport) => (
              <div key={sport} className="rounded-[28px] bg-white p-7">
                <p className="text-[28px] font-semibold text-[#0b0d10]">{sport}</p>
                <p className="mt-3 text-[17px] leading-[1.45] text-black/58">
                  Match odds, simple picks, and slip-friendly markets.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-14">
          {sections.map((section, index) => (
            <article key={section.label} className="grid gap-8 border-t border-black/10 pt-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div className={index % 2 === 1 ? "lg:order-2" : ""}>
                <div className="flex items-center justify-between text-[13px] uppercase tracking-[1px] text-black/44">
                  <span>{section.label}</span>
                  <span>{section.number}</span>
                </div>
                <h2 className="mt-8 max-w-xl text-[40px] font-semibold leading-[1.05] sm:text-[56px]">
                  {section.title}
                </h2>
                <p className="mt-5 max-w-xl text-[18px] leading-[1.5] text-black/62">{section.body}</p>
                <a href="#trust" className="mt-7 inline-flex rounded-full bg-[#0b0d10] px-6 py-3 text-[16px] font-semibold text-white">
                  Learn more
                </a>
              </div>
              <FeatureVisual title={section.imageTitle} rows={section.rows} />
            </article>
          ))}
        </div>
      </section>

      <section id="trust" className="bg-[#080a0d] text-white">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-[13px] uppercase tracking-[1px] text-white/44">Trust</p>
              <h2 className="mt-6 max-w-4xl text-[48px] font-semibold leading-[1.02] sm:text-[72px] lg:text-[92px]">
                Results checked with a sports odds source.
              </h2>
            </div>
            <p className="max-w-xl text-[20px] leading-[1.5] text-white/68">
              TxLINE odds help confirm what happened after the match. That keeps the experience clear for users:
              pick the game, place the slip, wait for the final result, and see the outcome.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              "Sports only. No unrelated markets.",
              "Odds shown in a familiar sportsbook format.",
              "Result checks use TxLINE odds and sports data.",
            ].map((item) => (
              <div key={item} className="rounded-[28px] border border-white/10 bg-white/[0.05] p-7">
                <p className="text-[22px] font-medium leading-[1.35]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <h2 className="text-[48px] font-semibold leading-[1.02] sm:text-[72px] lg:text-[92px]">
            A cleaner way to place sports slips.
          </h2>
          <div className="rounded-[32px] bg-white p-7">
            <p className="text-[22px] leading-[1.45] text-black/68">
              The current app is being rebuilt from the ground up around sports markets. The goal is simple:
              fewer confusing screens, clearer odds, and a betting flow users already understand.
            </p>
            <a href="#top" className="mt-8 inline-flex rounded-full bg-[#0b0d10] px-6 py-3 text-[16px] font-semibold text-white">
              Back to top
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
