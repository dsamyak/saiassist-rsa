import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AUDIT_ACTION_LABELS } from '@shared/constants';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import type { AuditEntry, Dealer, Paged } from '@/lib/types';
import { AuditTable } from '@/components/AuditTable';
import { Card, ErrorState, Field, Input, PageHeader, Pagination, SearchInput, Select } from '@/components/ui';

export default function Audit() {
  useDocumentTitle('Audit log');
  const { session } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  const [f, setF] = useUrlState({ q: '', action: '', result: '', dealerId: '', from: '', to: '', page: '1' });
  const [search, setSearch] = useSyncedInput(f.q, (v) => setF({ q: v }));
  const q = useQuery({
    queryKey: ['audit', f],
    queryFn: () => api<Paged<AuditEntry>>('/api/audit-logs', { query: { ...f, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
  const dealers = useQuery({ queryKey: ['dealers-filter'], queryFn: () => api<Paged<Dealer>>('/api/admin/dealers', { query: { pageSize: 200 } }), enabled: isSuper });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every sign-in, policy, payment and configuration change, with who did it and when" />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-12">
          <SearchInput value={search} onChange={setSearch} placeholder="Record, user or note" className="md:col-span-3" />
          <Select value={f.action} onChange={(e) => setF({ action: e.target.value })} className="md:col-span-3" aria-label="Action">
            <option value="">All actions</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={f.result} onChange={(e) => setF({ result: e.target.value })} className="md:col-span-2" aria-label="Result">
            <option value="">Any result</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
          </Select>
          {isSuper && (
            <Select value={f.dealerId} onChange={(e) => setF({ dealerId: e.target.value })} className="md:col-span-4" aria-label="Dealer">
              <option value="">All dealers & platform</option>
              {dealers.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.dealerName}
                </option>
              ))}
            </Select>
          )}
          <div className="flex gap-2 md:col-span-4">
            <Field label="From" className="flex-1">
              <Input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} />
            </Field>
            <Field label="To" className="flex-1">
              <Input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} />
            </Field>
          </div>
        </div>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <AuditTable rows={q.data?.items} loading={q.isLoading} fetching={q.isFetching} showDealer={isSuper} />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setF({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
    </div>
  );
}
