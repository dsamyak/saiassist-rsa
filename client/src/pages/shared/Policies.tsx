import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FilePlus2, RotateCcw } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/files';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import { toQueryString } from '@/lib/api';
import type { Dealer, Paged, PolicyListItem, Product } from '@/lib/types';
import { PolicyTable } from '@/components/PolicyTable';
import { Button, Card, ErrorState, Field, Input, LinkButton, PageHeader, Pagination, SearchInput, Select, toast } from '@/components/ui';

const STATUS_OPTIONS = [
  { value: '', label: 'All policies' },
  { value: 'IN_FORCE', label: 'In force (active + expiring)' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRING_SOON', label: 'Expiring soon' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'PAYMENT_PENDING', label: 'Payment pending' },
  { value: 'RENEWED', label: 'Renewed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DRAFT', label: 'Quotations (drafts)' },
];

const FIELD_OPTIONS = [
  { value: '', label: 'All fields' },
  { value: 'policyNumber', label: 'Certificate number' },
  { value: 'customerName', label: 'Customer name' },
  { value: 'mobile', label: 'Customer mobile' },
  { value: 'registrationNo', label: 'Registration number' },
  { value: 'chassisNo', label: 'Chassis number' },
  { value: 'engineNo', label: 'Engine number' },
];

const DEFAULTS = { q: '', field: '', status: '', productId: '', dealerId: '', from: '', to: '', page: '1' };

export default function Policies() {
  const { session, can } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  useDocumentTitle(isSuper ? 'All policies' : 'Policies');
  const [f, setF] = useUrlState(DEFAULTS);
  const [search, setSearch] = useSyncedInput(f.q, (v) => setF({ q: v }));
  const query = { ...f, pageSize: 20 };

  const q = useQuery({
    queryKey: ['policies', query],
    queryFn: () => api<Paged<PolicyListItem>>('/api/policies', { query }),
    placeholderData: keepPreviousData,
  });
  const products = useQuery({ queryKey: ['products-filter', isSuper], queryFn: () => api<Product[]>(isSuper ? '/api/admin/rsa/products' : '/api/rsa/products') });
  const dealers = useQuery({
    queryKey: ['dealers-filter'],
    queryFn: () => api<Paged<Dealer>>('/api/admin/dealers', { query: { pageSize: 200 } }),
    enabled: isSuper,
  });
  const filtered = Object.entries(f).some(([k, v]) => k !== 'page' && v);

  const exportCsv = async () => {
    const { page: _p, ...rest } = f;
    try {
      await downloadFile(`/api/policies/export${toQueryString(rest)}`, 'rsa-policies.csv');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title={isSuper ? 'All policies' : 'Policies'}
        subtitle={isSuper ? 'Every RSA policy across all dealers' : 'Search, download, renew and manage RSA certificates'}
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={exportCsv}>
              Export CSV
            </Button>
            {!isSuper && can('policies.issue') && (
              <LinkButton to="/app/issue" icon={FilePlus2}>
                Issue RSA
              </LinkButton>
            )}
          </>
        }
      />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-12">
          <div className="flex gap-2 md:col-span-6 xl:col-span-5">
            <Select value={f.field} onChange={(e) => setF({ field: e.target.value })} className="w-44 shrink-0" aria-label="Search by">
              {FIELD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <SearchInput value={search} onChange={setSearch} placeholder="Certificate no., name, mobile, reg., chassis…" className="flex-1" />
          </div>
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} className="md:col-span-3 xl:col-span-2" aria-label="Status">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select value={f.productId} onChange={(e) => setF({ productId: e.target.value })} className="md:col-span-3 xl:col-span-2" aria-label="Plan">
            <option value="">All plans</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.planName}
              </option>
            ))}
          </Select>
          {isSuper && (
            <Select value={f.dealerId} onChange={(e) => setF({ dealerId: e.target.value })} className="md:col-span-4 xl:col-span-3" aria-label="Dealer">
              <option value="">All dealers</option>
              {dealers.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.dealerName}
                </option>
              ))}
            </Select>
          )}
          <div className="flex items-end gap-2 md:col-span-8 xl:col-span-5">
            <Field label="Issued from" className="flex-1">
              <Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} />
            </Field>
            <Field label="to" className="flex-1">
              <Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} />
            </Field>
            {filtered && (
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setSearch('');
                  setF(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, ''])) as Partial<typeof DEFAULTS>);
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <PolicyTable rows={q.data?.items} loading={q.isLoading} fetching={q.isFetching} showDealer={isSuper} />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setF({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
    </div>
  );
}
