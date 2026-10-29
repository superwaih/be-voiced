/** Four bars, loudest in the middle: the Be Voiced mark. */
export function BrandMark({ size = 22, tone = "rail" }: { size?: number; tone?: "rail" | "accent" }) {
  const strong = tone === "rail" ? "var(--brand-strong)" : "var(--accent)";
  const soft = tone === "rail" ? "var(--brand-soft)" : "var(--accent-line)";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1.5" y="7" width="3.2" height="6" rx="1.6" fill={soft} />
      <rect x="6.3" y="3" width="3.2" height="14" rx="1.6" fill={strong} />
      <rect x="11.1" y="5.5" width="3.2" height="9" rx="1.6" fill={strong} />
      <rect x="15.9" y="8" width="2.6" height="4" rx="1.3" fill={soft} />
    </svg>
  );
}
