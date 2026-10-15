// Masking helpers for the public verification page (no unnecessary personal information).

export function maskName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : w[0] + '*'.repeat(Math.min(w.length - 1, 6))))
    .join(' ');
}

export function maskMiddle(value: string | null | undefined, keepStart = 2, keepEnd = 4): string {
  if (!value) return '';
  const v = value.trim();
  if (v.length <= keepStart + keepEnd) return v[0] + '*'.repeat(Math.max(v.length - 1, 0));
  return v.slice(0, keepStart) + '*'.repeat(v.length - keepStart - keepEnd) + v.slice(-keepEnd);
}

export function maskMobile(m: string | null | undefined): string {
  if (!m) return '';
  return m.length > 4 ? '*'.repeat(m.length - 4) + m.slice(-4) : m;
}
