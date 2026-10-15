import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import type { Customer, Paged } from '@/lib/types';
import { CustomerForm } from '@/components/forms';
import { Button, Card, DataTable, EmptyState, ErrorState, Modal, PageHeader, Pagination, SearchInput, toast, type Column } from '@/components/ui';

export default function Customers() {
  useDocumentTitle('Customers');
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useUrlState({ search: '', page: '1' });
  const [search, setSearch] = useSyncedInput(state.search, (v) => setState({ search: v }));
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['customers', state],
    queryFn: () => api<Paged<Customer>>('/api/customers', { query: { search: state.search, page: state.page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (c) => (
        <div>
          <p className="font-medium text-slate-900">{c.name}</p>
          <p className="text-xs text-slate-500">{c.email ?? '—'}</p>
        </div>
      ),
    },
    { key: 'mobile', header: 'Mobile', cell: (c) => <span className="tabular">{c.mobile}</span> },
    { key: 'city', header: 'City', cell: (c) => `${c.city}, ${c.state}` },
    { key: 'vehicles', header: 'Vehicles', align: 'right', cell: (c) => c.vehicleCount ?? 0 },
    { key: 'policies', header: 'Policies', align: 'right', cell: (c) => c.policyCount ?? 0 },
    { key: 'updated', header: 'Last updated', cell: (c) => <span className="text-xs text-slate-500">{formatDate(c.updatedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Certificate holders registered with your dealership"
        actions={
          can('customers.create') && (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              New customer
            </Button>
          )
        }
      />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, mobile, email, city or registration no." className="max-w-md" />
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={q.data?.items}
              rowKey={(c) => c.id}
              loading={q.isLoading}
              fetching={q.isFetching}
              onRowClick={(c) => navigate(`/app/customers/${c.id}`)}
              empty={<EmptyState icon={Users} title="No customers found" description={state.search ? 'Try another search.' : 'Customers you add will appear here.'} />}
            />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setState({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New customer" size="lg">
        <CustomerForm
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            toast.success('Customer created');
            qc.invalidateQueries({ queryKey: ['customers'] });
            navigate(`/app/customers/${c.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
