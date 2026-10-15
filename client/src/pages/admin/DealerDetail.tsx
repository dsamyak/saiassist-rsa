import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Power, Save, UserPlus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { openPdf } from '@/lib/files';
import { formatDate, formatMoney, initials, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Dealer, Paged, PolicyListItem, User } from '@/lib/types';
import { DealerProfileForm, dealerPayload, initDealerForm, type DealerFormState } from '@/components/DealerProfileForm';
import { PolicyTable } from '@/components/PolicyTable';
import { ActiveBadge } from '@/components/StatusBadge';
import { TempPasswordModal, UserDialog, UsersTable, resetUserPassword } from '@/components/users';
import { Alert, Button, Card, DL, ErrorState, Input, PageHeader, PageLoader, Switch, Tabs, toast } from '@/components/ui';

type Tab = 'overview' | 'profile' | 'products' | 'users';

interface ProductConfig {
  productId: string;
  productCode: string;
  planName: string;
  status: string;
  isEnabled: boolean;
  priceIncludesGst: boolean;
  gstRate: number;
  vehicleTypes: string[];
  terms: { termId: string; label: string; status: string; basePrice: number; dealerPrice: number | null }[];
}

export default function DealerDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const q = useQuery({ queryKey: ['dealer', id], queryFn: () => api<Dealer & { users: User[] }>(`/api/admin/dealers/${id}`) });
  useDocumentTitle(q.data?.dealerName ?? 'Dealer');
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dealer', id] });
    qc.invalidateQueries({ queryKey: ['dealers'] });
  };
  const toggleStatus = async () => {
    const next = d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (next === 'INACTIVE' && !window.confirm(`Deactivate ${d.dealerName}? All its users will be signed out and blocked until reactivated.`)) return;
    try {
      await api(`/api/admin/dealers/${d.id}/status`, { method: 'PATCH', body: { status: next } });
      toast.success(next === 'ACTIVE' ? 'Dealer activated' : 'Dealer deactivated');
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/admin/dealers', label: 'Dealers' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.logoUrl ? (
              <img src={d.logoUrl} alt="" className="h-10 max-w-[140px] object-contain" />
            ) : (
              <span className="grid size-10 place-items-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600">{initials(d.dealerName)}</span>
            )}
            {d.dealerName}
            <ActiveBadge status={d.status} />
          </span>
        }
        subtitle={`${d.dealerCode} · onboarded ${formatDate(d.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" icon={Eye} onClick={() => openPdf(`/api/admin/dealers/${d.id}/certificate-preview`, 'sample.pdf').catch((e) => toast.error(errorMessage(e)))}>
              Sample certificate
            </Button>
            <Button variant={d.status === 'ACTIVE' ? 'danger' : 'success'} icon={Power} onClick={toggleStatus}>
              {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'profile', label: 'Profile & branding' },
          { key: 'products', label: 'Products & pricing' },
          { key: 'users', label: 'Users', count: d.users.length },
        ]}
      />
      {tab === 'overview' && <Overview dealer={d} />}
      {tab === 'profile' && <ProfileTab dealer={d} onSaved={refresh} />}
      {tab === 'products' && <ProductsTab dealerId={d.id} />}
      {tab === 'users' && <UsersTab dealer={d} onChanged={refresh} />}
    </div>
  );
}

function Overview({ dealer: d }: { dealer: Dealer }) {
  const policies = useQuery({
    queryKey: ['policies', 'dealer', d.id],
    queryFn: () => api<Paged<PolicyListItem>>('/api/policies', { query: { dealerId: d.id, pageSize: 8 } }),
  });
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Certificate details">
          <DL
            items={[
              { label: 'Legal name', value: d.legalName },
              { label: 'Issuer', value: d.issuerName },
              { label: 'GSTIN', value: d.gstin },
              { label: 'Numbering', value: d.policyNumberFormat ? <span className="font-mono">{d.policyNumberFormat}</span> : 'Platform default' },
              { label: 'Servicing office', value: <span className="whitespace-pre-line">{d.servicingOffice}</span>, full: true },
            ]}
          />
        </Card>
        <Card title="Contact">
          <DL
            items={[
              { label: 'Address', value: [d.address, d.city, d.state, d.pincode].filter(Boolean).join(', '), full: true },
              { label: 'Phone', value: d.phone },
              { label: 'Email', value: d.email },
              { label: 'Website', value: d.website },
              { label: 'RSA helpline', value: d.rsaPhone ?? 'Platform default' },
            ]}
          />
        </Card>
      </div>
      <Card
        title="Recent policies"
        padded={false}
        actions={
          <Link to={`/admin/policies?dealerId=${d.id}`} className="text-xs font-medium text-brand-700 hover:underline">
            View all
          </Link>
        }
      >
        <PolicyTable rows={policies.data?.items} loading={policies.isLoading} />
      </Card>
    </div>
  );
}

function ProfileTab({ dealer, onSaved }: { dealer: Dealer; onSaved: () => void }) {
  const [form, setForm] = useState<DealerFormState>(() => initDealerForm(dealer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(initDealerForm(dealer)), [dealer]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/dealers/${dealer.id}`, { method: 'PUT', body: dealerPayload(form) });
      toast.success('Dealer profile saved');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="info">Changes apply to certificates issued from now on. Certificates already issued keep the details they were issued with.</Alert>
      <DealerProfileForm value={form} onChange={setForm} mode="edit" currentLogoUrl={dealer.logoUrl} />
      <div className="sticky bottom-4 flex justify-end">
        <Button size="lg" icon={Save} loading={busy} onClick={save} className="shadow-lg">
          Save profile
        </Button>
      </div>
    </div>
  );
}

function ProductsTab({ dealerId }: { dealerId: string }) {
  const q = useQuery({ queryKey: ['dealer-products-config', dealerId], queryFn: () => api<ProductConfig[]>(`/api/admin/dealers/${dealerId}/products`) });
  const [rows, setRows] = useState<ProductConfig[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data]);
  if (q.isLoading || !rows) return <PageLoader />;
  const update = (pid: string, patch: Partial<ProductConfig>) => setRows(rows.map((r) => (r.productId === pid ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    try {
      const res = await api<ProductConfig[]>(`/api/admin/dealers/${dealerId}/products`, {
        method: 'PUT',
        body: { items: rows.map((r) => ({ productId: r.productId, isEnabled: r.isEnabled, prices: r.terms.map((t) => ({ termId: t.termId, dealerPrice: t.dealerPrice })) })) },
      });
      setRows(res);
      toast.success('Products & pricing saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Alert tone="info">Enable the plans this dealer may sell. A dealer price overrides the standard price for that validity option; leave it blank to use the standard price.</Alert>
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.productId} padded>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {r.planName} <span className="font-mono text-xs font-normal text-slate-500">{r.productCode}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {r.vehicleTypes.map(vehicleTypeLabel).join(', ')} · GST {r.gstRate}% · prices {r.priceIncludesGst ? 'include' : 'exclude'} GST
                  {r.status !== 'ACTIVE' && ' · product inactive'}
                </p>
              </div>
              <Switch checked={r.isEnabled} onChange={(v) => update(r.productId, { isEnabled: v })} label={r.isEnabled ? 'Enabled' : 'Disabled'} />
            </div>
            {r.isEnabled && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.terms
                  .filter((t) => t.status === 'ACTIVE')
                  .map((t) => (
                    <div key={t.termId} className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                      <p className="text-sm font-medium text-slate-800">{t.label}</p>
                      <p className="text-xs text-slate-500">Standard price {formatMoney(t.basePrice)}</p>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="mt-2"
                        placeholder="Dealer price (optional)"
                        value={t.dealerPrice ?? ''}
                        onChange={(e) =>
                          update(r.productId, {
                            terms: r.terms.map((x) => (x.termId === t.termId ? { ...x, dealerPrice: e.target.value === '' ? null : Number(e.target.value) } : x)),
                          })
                        }
                      />
                    </div>
                  ))}
              </div>
            )}
          </Card>
        ))}
      </div>
      <div className="sticky bottom-4 flex justify-end">
        <Button size="lg" icon={Save} loading={busy} onClick={save} className="shadow-lg">
          Save products & pricing
        </Button>
      </div>
    </div>
  );
}

function UsersTab({ dealer, onChanged }: { dealer: Dealer & { users: User[] }; onChanged: () => void }) {
  const [dialog, setDialog] = useState<{ user: User | null } | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  return (
    <>
      <Card
        title="Dealer users"
        subtitle="Dealer Admins manage their own employees; you can manage any account here"
        padded={false}
        actions={
          <Button size="sm" icon={UserPlus} onClick={() => setDialog({ user: null })}>
            Add user
          </Button>
        }
      >
        <UsersTable rows={dealer.users} onEdit={(u) => setDialog({ user: u })} onReset={(u) => resetUserPassword(`/api/admin/users/${u.id}/reset-password`, u, setTemp)} />
      </Card>
      <UserDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        user={dialog?.user ?? null}
        title={dialog?.user ? 'Edit dealer user' : `Add user to ${dealer.dealerName}`}
        createPath={`/api/admin/dealers/${dealer.id}/users`}
        updatePath={(uid) => `/api/admin/users/${uid}`}
        showPermissions
        allowRoleChange
        onSaved={({ user, temporaryPassword }) => {
          setDialog(null);
          toast.success('User saved');
          onChanged();
          if (temporaryPassword) setTemp({ email: user.email, password: temporaryPassword });
        }}
      />
      <TempPasswordModal data={temp} onClose={() => setTemp(null)} />
    </>
  );
}
