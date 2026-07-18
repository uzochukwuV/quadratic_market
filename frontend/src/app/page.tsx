export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_36%),linear-gradient(180deg,_#111111_0%,_#070707_100%)] text-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
        <div className="max-w-3xl">
          <p className="mb-4 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.3em] text-white/70">
            Quadratic Market
          </p>
          <h1 className="max-w-2xl text-5xl font-medium leading-[0.95] tracking-tight sm:text-6xl md:text-7xl">
            Sports markets on Solana.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-white/70 sm:text-lg">
            A stripped-back landing page while the protocol and app surface are rebuilt from the ground up.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href="#about"
              className="inline-flex items-center justify-center rounded-full bg-[#f5ff00] px-6 py-3 font-medium text-black transition hover:brightness-105"
            >
              Learn more
            </a>
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Sports first", "Only fixture-based sports markets."],
            ["Simple surface", "One landing page, no extra app chrome."],
            ["Rebuild ready", "Clean base for the next frontend pass."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-lg font-medium">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/65">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
