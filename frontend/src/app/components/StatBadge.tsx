export function StatBadge({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "amber" | "red";
}) {
  const color =
    accent === "green" ? "text-[#a0e0ab]"
    : accent === "amber" ? "text-[#ffac2e]"
    : accent === "red" ? "text-[#f47067]"
    : "text-white";

  return (
    <div className="glass-card rounded-card p-6 flex flex-col gap-1">
      <p className="text-[11px] text-whisper-gray uppercase tracking-widest">{label}</p>
      <p className={`text-[29px] font-semibold leading-tight ${color}`}>{value}</p>
      {sub && <p className="text-[12px] text-whisper-gray">{sub}</p>}
    </div>
  );
}
