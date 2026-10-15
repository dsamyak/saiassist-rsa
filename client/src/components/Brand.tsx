import { cn } from './ui';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} aria-hidden>
      <path d="M32 4 8 13v17c0 15.6 10.3 26.9 24 30 13.7-3.1 24-14.4 24-30V13L32 4Z" fill="#1d41d8" />
      <path d="M32 9.5 13 16.6v13.6c0 12.7 8.1 22 19 24.7 10.9-2.7 19-12 19-24.7V16.6L32 9.5Z" fill="#2554eb" />
      <path d="M31.4 22h1.2v4h-1.2zm0 7h1.2v4h-1.2zm0 7h1.2v4h-1.2z" fill="#f5b100" />
      <path d="M20 31.5 28.5 40 44 24.5" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandLockup({ name, dark = false, className }: { name: string; dark?: boolean; className?: string }) {
  const [first, ...rest] = name.split(' ');
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className={cn('text-[15px] font-semibold tracking-tight', dark ? 'text-white' : 'text-slate-900')}>
        {first}
        {rest.length > 0 && <span className={dark ? 'text-gold-400' : 'text-brand-700'}> {rest.join(' ')}</span>}
      </span>
    </span>
  );
}
