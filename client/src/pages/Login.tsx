import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileCheck2, QrCode, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { BrandLockup } from '@/components/Brand';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function Login() {
  useDocumentTitle('Sign in');
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: brand } = useQuery({ queryKey: ['branding'], queryFn: () => api<{ platformName: string; helpline: string }>('/api/public/branding') });

  if (session) return <Navigate to="/" replace />;
  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await login(email, password);
      navigate(s.user.mustChangePassword ? '/change-password' : from && from !== '/' ? from : s.user.role === 'SUPER_ADMIN' ? '/admin' : '/app', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const name = brand?.platformName ?? 'SaiAssist RSA';
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-32 -top-32 size-[520px] rounded-full bg-brand-700/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-gold-400/10 blur-3xl" />
        <BrandLockup name={name} dark className="relative" />
        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">Roadside Assistance policies, issued in minutes.</h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            One secure platform for every dealership — standardised RSA certificates, dealer branding, renewals and reports.
          </p>
          <ul className="mt-10 space-y-5">
            {[
              { icon: Building2, title: 'Separate dealer workspaces', text: 'Each dealer sees only its own customers, vehicles and policies.' },
              { icon: FileCheck2, title: 'Tax Invoice cum Certificate', text: 'Premium, GST and coverage calculated and printed automatically.' },
              { icon: QrCode, title: 'QR verification', text: 'Every certificate can be verified online in seconds.' },
            ].map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 text-gold-400">
                  <f.icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{f.title}</span>
                  <span className="block text-sm text-slate-400">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          {brand?.helpline ? `RSA helpline ${brand.helpline} · ` : ''}© {new Date().getFullYear()} {name}
        </p>
      </aside>

      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <BrandLockup name={name} className="lg:hidden" />
          <h2 className="mt-8 text-2xl font-semibold tracking-tight text-slate-900 lg:mt-0">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-slate-500">Dealer staff and platform administrators sign in with their registered email.</p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Email address">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-500">Forgot your password? Ask your Dealer Admin or the platform administrator to reset it.</p>
          <div className="mt-10 rounded-xl bg-slate-100/80 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-700" />
              <div className="text-sm">
                <p className="font-medium text-slate-800">Have an RSA certificate?</p>
                <p className="mt-0.5 text-slate-500">
                  <Link to="/verify" className="font-medium text-brand-700 hover:underline">
                    Verify it online
                  </Link>{' '}
                  using the certificate number or QR code.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
