import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CalendarRange, Car, Headphones, Search, ShieldAlert, ShieldX, Store, User } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import { BrandLockup } from '@/components/Brand';
import { PolicyStatusBadge } from '@/components/StatusBadge';
import { Alert, Button, Input, Spinner, cn } from '@/components/ui';

interface VerifyResult {
  found: true;
  platformName: string;
  policyNumber: string;
  status: string;
  planName: string;
  productName: string;
  startDate: string;
  endDate: string;
  issuedAt: string;
  numberOfServices: number;
  dealerName: string;
  dealerLogoUrl: string | null;
  helpline: string;
  customerName: string;
  vehicle: { type: string; makeModel: string; registrationNo: string; chassisNo: string };
}

const VALID = ['ACTIVE', 'EXPIRING_SOON'];

export default function Verify() {
  const { policyNumber } = useParams();
  useDocumentTitle(policyNumber ? `Verify ${policyNumber}` : 'Verify certificate');
  const navigate = useNavigate();
  const [input, setInput] = useState(policyNumber ?? '');
  useEffect(() => setInput(policyNumber ?? ''), [policyNumber]);
  const { data: brand } = useQuery({ queryKey: ['branding'], queryFn: () => api<{ platformName: string }>('/api/public/branding') });
  const q = useQuery({
    queryKey: ['verify', policyNumber],
    queryFn: () => api<VerifyResult>(`/api/public/policies/verify/${encodeURIComponent(policyNumber!)}`),
    enabled: !!policyNumber,
    retry: false,
  });
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const r = q.data;
  const valid = r && VALID.includes(r.status);

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-950 via-brand-950 to-slate-50 to-[340px]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <Link to="/login">
          <BrandLockup name={brand?.platformName ?? 'SaiAssist RSA'} dark />
        </Link>
        <h1 className="mt-10 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Verify an RSA certificate</h1>
        <p className="mt-2 text-sm text-slate-300">Enter the Tax Invoice cum Certificate Number printed on the certificate, or scan its QR code.</p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim().toUpperCase();
            if (v) navigate(`/verify/${encodeURIComponent(v)}`);
          }}
        >
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. SA2026101400001" className="h-11 uppercase" aria-label="Certificate number" />
          <Button type="submit" size="lg" icon={Search}>
            Verify
          </Button>
        </form>

        <div className="mt-8">
          {q.isLoading && (
            <div className="flex items-center justify-center gap-3 rounded-2xl bg-white p-10 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
              <Spinner /> Checking certificate…
            </div>
          )}
          {notFound && (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
              <span className="mx-auto grid size-14 place-items-center rounded-full bg-red-50 text-red-600">
                <ShieldX className="size-7" />
              </span>
              <p className="mt-4 text-lg font-semibold text-slate-900">No certificate found</p>
              <p className="mt-1 text-sm text-slate-500">
                We could not find a certificate numbered <span className="font-mono font-medium text-slate-700">{policyNumber}</span>. Check the number and try again.
              </p>
            </div>
          )}
          {q.error && !notFound && <Alert tone="error">{(q.error as Error).message}</Alert>}
          {r && (
            <div className="animate-fade-in overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className={cn('flex items-center gap-4 px-6 py-5', valid ? 'bg-emerald-50' : 'bg-slate-50')}>
                <span className={cn('grid size-12 shrink-0 place-items-center rounded-full', valid ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600')}>
                  {valid ? <BadgeCheck className="size-6" /> : <ShieldAlert className="size-6" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-base font-semibold', valid ? 'text-emerald-900' : 'text-slate-900')}>
                    {valid ? 'Genuine certificate - cover is valid' : 'Genuine certificate - cover is not currently valid'}
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-slate-600">{r.policyNumber}</p>
                </div>
                <PolicyStatusBadge status={r.status} />
              </div>
              <dl className="grid gap-x-6 gap-y-5 px-6 py-6 sm:grid-cols-2">
                <Item icon={BadgeCheck} label="RSA plan" value={`${r.planName}`} sub={r.productName !== r.planName ? r.productName : undefined} />
                <Item icon={CalendarRange} label="Validity" value={`${formatDateTime(r.startDate)} to ${formatDateTime(r.endDate)}`} sub="Indian Standard Time" />
                <Item icon={User} label="Certificate holder" value={r.customerName} />
                <Item icon={Car} label="Vehicle" value={`${r.vehicle.makeModel} · ${r.vehicle.type}`} sub={`Reg. ${r.vehicle.registrationNo} · Chassis ${r.vehicle.chassisNo}`} />
                <Item icon={Store} label="Issued by" value={r.dealerName} sub={`on ${formatDateTime(r.issuedAt)}`} />
                <Item icon={Headphones} label="Roadside assistance helpline" value={r.helpline} sub={`${r.numberOfServices} service${r.numberOfServices === 1 ? '' : 's'} during the plan`} />
              </dl>
              <p className="border-t border-slate-100 px-6 py-4 text-xs text-slate-500">
                Personal details are partially hidden for privacy. For assistance, call the helpline printed on your certificate.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Item({ icon: Icon, label, value, sub }: { icon: typeof User; label: string; value: string; sub?: string }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
        {sub && <dd className="mt-0.5 text-xs text-slate-500">{sub}</dd>}
      </div>
    </div>
  );
}
