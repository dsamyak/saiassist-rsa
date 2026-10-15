import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney0, formatNumber, initials } from '@/lib/format';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import type { Dealer, Paged } from '@/lib/types';
import { ActiveBadge } from '@/components/StatusBadge';
import { Card, DataTable, EmptyState, ErrorState, LinkButton, PageHeader, Pagination, SearchInput, Select, type Column } from '@/components/ui';

export default function Dealers() {
  useDocumentTitle('Dealers');
  const navigate = useNavigate();
  const [f, setF] = useUrlState({ search: '', status: '', page: '1' });
  const [search, setSearch] = useSyncedInput(f.search, (v) => setF({ search: v }));
  const q = useQuery({
    queryKey: ['dealers', f],
    queryFn: () => api<Paged<Dealer>>('/api/admin/dealers', { query: { ...f, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Dealer>[] = [
    {
      key: 'dealer',
      header: 'Dealer',
      cell: (d) => (
        <div className="flex items-center gap-3">
          {d.logoUrl ? (
            <img src={d.logoUrl} alt="" className="h-9 w-20 rounded object-contain" />
          ) : (
            <span className="grid h-9 w-20 place-items-center rounded bg-slate-100 text-xs font-semibold text-slate-600">{initials(d.dealerName)}</span>
          )}
          <div>
            <p className="font-medium text-slate-900">{d.dealerName}</p>
            <p className="font-mono text-xs text-slate-500">{d.dealerCode}</p>
          </div>
        </div>
      ),
    },
    { key: 'city', header: 'Location', cell: (d) => [d.city, d.state].filter(Boolean).join(', ') || '—' },
    { key: 'numbering', header: 'Numbering', cell: (d) => <span className="font-mono text-xs text-slate-600">{d.policyNumberFormat ?? 'Platform default'}</span> },
    { key: 'policies', header: 'Policies', align: 'right', cell: (d) => <span className="tabular">{formatNumber(d.stats?.policies ?? 0)}</span> },
    { key: 'active', header: 'Active', align: 'right', cell: (d) => <span className="tabular">{formatNumber(d.stats?.active ?? 0)}</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', cell: (d) => <span className="font-medium tabular">{formatMoney0(d.stats?.revenue ?? 0)}</span> },
    { key: 'users', header: 'Users', align: 'right', cell: (d) => d.stats?.users ?? 0 },
    { key: 'status', header: 'Status', cell: (d) => <ActiveBadge status={d.status} /> },
  ];
  return (
    <div>
      <PageHeader
        title="Dealers"
        subtitle="Every dealership gets its own isolated workspace, branding and numbering"
        actions={
          <LinkButton to="/admin/dealers/new" icon={Plus}>
            Onboard dealer
          </LinkButton>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search dealer name, code or city" className="sm:max-w-md sm:flex-1" />
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} className="sm:w-48" aria-label="Status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={q.data?.items}
              rowKey={(d) => d.id}
              loading={q.isLoading}
              fetching={q.isFetching}
              onRowClick={(d) => navigate(`/admin/dealers/${d.id}`)}
              empty={<EmptyState icon={Building2} title="No dealers yet" action={<LinkButton to="/admin/dealers/new" icon={Plus}>Onboard the first dealer</LinkButton>} />}
            />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setF({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
    </div>
  );
}
