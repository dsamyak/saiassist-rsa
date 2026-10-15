import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Car, FilePlus2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, fuelTypeLabel, inRenewalWindow, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import type { Paged, Vehicle } from '@/lib/types';
import { Badge, Card, DataTable, EmptyState, ErrorState, LinkButton, PageHeader, Pagination, SearchInput, type Column } from '@/components/ui';

export default function Vehicles() {
  useDocumentTitle('Vehicles');
  const { can } = useAuth();
  const [state, setState] = useUrlState({ search: '', page: '1' });
  const [search, setSearch] = useSyncedInput(state.search, (v) => setState({ search: v }));
  const q = useQuery({
    queryKey: ['vehicles', state],
    queryFn: () => api<Paged<Vehicle>>('/api/vehicles', { query: { search: state.search, page: state.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Vehicle>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (v) => (
        <div>
          <p className="font-medium text-slate-900">
            {v.make} {v.model}
          </p>
          <p className="text-xs text-slate-500">{v.variant}</p>
        </div>
      ),
    },
    { key: 'reg', header: 'Registration', cell: (v) => <span className="font-mono text-xs">{v.registrationNo ?? 'New'}</span> },
    { key: 'chassis', header: 'Chassis / Engine', cell: (v) => <span className="font-mono text-xs text-slate-600">{v.chassisNo ?? '—'} / {v.engineNo ?? '—'}</span> },
    { key: 'type', header: 'Type', cell: (v) => `${vehicleTypeLabel(v.vehicleType)} · ${fuelTypeLabel(v.fuelType)} · ${v.manufacturingYear}` },
    {
      key: 'customer',
      header: 'Customer',
      cell: (v) => (
        <Link to={`/app/customers/${v.customerId}`} className="text-brand-700 hover:underline">
          {v.customerName}
        </Link>
      ),
    },
    {
      key: 'cover',
      header: 'RSA cover',
      cell: (v) =>
        v.activePolicy ? (
          <Badge tone={v.activePolicy.status === 'PAYMENT_PENDING' ? 'amber' : 'green'}>
            {v.activePolicy.status === 'PAYMENT_PENDING' ? 'Payment pending' : `Till ${formatDate(v.activePolicy.endDate)}`}
          </Badge>
        ) : (
          <Badge tone="gray">No active cover</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (v) =>
        v.activePolicy
          ? can('policies.renew') &&
            v.activePolicy.status === 'ACTIVE' &&
            inRenewalWindow(v.activePolicy.endDate) && (
              <LinkButton size="sm" variant="outline" icon={RefreshCw} to={`/app/issue?renew=${v.activePolicy.id}`}>
                Renew
              </LinkButton>
            )
          : can('policies.issue') && (
              <LinkButton size="sm" variant="outline" icon={FilePlus2} to={`/app/issue?vehicle=${v.id}`}>
                Issue RSA
              </LinkButton>
            ),
    },
  ];
  return (
    <div>
      <PageHeader title="Vehicles" subtitle="All vehicles registered by your dealership" />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Registration, chassis, engine, make, model or customer" className="max-w-md" />
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={q.data?.items}
              rowKey={(v) => v.id}
              loading={q.isLoading}
              fetching={q.isFetching}
              empty={<EmptyState icon={Car} title="No vehicles found" description="Vehicles are added from the customer page or while issuing a policy." />}
            />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setState({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
    </div>
  );
}
