import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass, IndianRupee, Undo2, Wallet } from 'lucide-react';
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from '@shared/constants';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney, formatMoney0, paymentMethodLabel } from '@/lib/format';
import { useDocumentTitle, useSyncedInput, useUrlState } from '@/lib/hooks';
import type { Dealer, Paged, Payment } from '@/lib/types';
import { PaymentStatusBadge } from '@/components/StatusBadge';
import { RecordPaymentModal } from '@/components/policyActions';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, SearchInput, Select, StatCard, type Column } from '@/components/ui';

type PaymentsResponse = Paged<Payment> & { totals: { collected: number; refunded: number; pending: number; pending_count: number; net: number } };

export default function Payments() {
  useDocumentTitle('Payments');
  const { session, can, base } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  const qc = useQueryClient();
  const [f, setF] = useUrlState({ q: '', status: '', method: '', dealerId: '', from: '', to: '', page: '1' });
  const [search, setSearch] = useSyncedInput(f.q, (v) => setF({ q: v }));
  const [recording, setRecording] = useState<Payment | null>(null);
  const q = useQuery({
    queryKey: ['payments', f],
    queryFn: () => api<PaymentsResponse>('/api/payments', { query: { ...f, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const dealers = useQuery({ queryKey: ['dealers-filter'], queryFn: () => api<Paged<Dealer>>('/api/admin/dealers', { query: { pageSize: 200 } }), enabled: isSuper });
  const t = q.data?.totals;
  const columns: Column<Payment>[] = [
    { key: 'date', header: 'Date', cell: (p) => <span className="text-xs text-slate-600 tabular">{formatDateTime(p.createdAt)}</span> },
    {
      key: 'policy',
      header: 'Policy',
      cell: (p) => (
        <Link to={`${base}/policies/${p.policyId}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
          {p.policyNumber ?? 'Quotation'}
        </Link>
      ),
    },
    ...(isSuper ? [{ key: 'dealer', header: 'Dealer', cell: (p: Payment) => p.dealerName }] : []),
    { key: 'customer', header: 'Customer', cell: (p) => p.customerName },
    {
      key: 'method',
      header: 'Method',
      cell: (p) => (
        <div>
          <p>{paymentMethodLabel(p.paymentMethod)}</p>
          {p.transactionId && <p className="font-mono text-xs text-slate-500">{p.transactionId}</p>}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (p) => (
        <div>
          <p className="font-medium text-slate-900 tabular">{formatMoney(p.totalAmount)}</p>
          <p className="text-xs text-slate-500 tabular">GST {formatMoney(p.gstAmount)}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (p) => <PaymentStatusBadge status={p.status} /> },
    { key: 'refund', header: 'Refund', align: 'right', cell: (p) => (p.refundAmount > 0 ? <span className="text-violet-700 tabular">{formatMoney(p.refundAmount)}</span> : '—') },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (p) =>
        p.status === 'PENDING' && !isSuper && can('payments.manage') ? (
          <Button size="sm" variant="outline" onClick={() => setRecording(p)}>
            Record payment
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle={isSuper ? 'Premium collections across all dealers' : 'Premium collections and refunds for your dealership'} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Collected" value={t ? formatMoney0(t.collected) : '—'} icon={IndianRupee} tone="green" hint="Successful payments (incl. GST)" />
        <StatCard label="Refunded" value={t ? formatMoney0(t.refunded) : '—'} icon={Undo2} tone="violet" />
        <StatCard label="Net collection" value={t ? formatMoney0(t.net) : '—'} icon={Wallet} />
        <StatCard label="Pending" value={t ? formatMoney0(t.pending) : '—'} icon={Hourglass} tone="amber" hint={t ? `${t.pending_count} payment(s) awaiting realisation` : undefined} />
      </div>
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-12">
          <SearchInput value={search} onChange={setSearch} placeholder="Certificate no., transaction ID, customer" className="md:col-span-4" />
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })} className="md:col-span-2" aria-label="Status">
            <option value="">All statuses</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={f.method} onChange={(e) => setF({ method: e.target.value })} className="md:col-span-2" aria-label="Method">
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
          {isSuper && (
            <Select value={f.dealerId} onChange={(e) => setF({ dealerId: e.target.value })} className="md:col-span-4" aria-label="Dealer">
              <option value="">All dealers</option>
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
            <DataTable columns={columns} rows={q.data?.items} rowKey={(p) => p.id} loading={q.isLoading} fetching={q.isFetching} empty={<EmptyState icon={Wallet} title="No payments found" />} />
            {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onChange={(p) => setF({ page: String(p) }, false)} />}
          </>
        )}
      </Card>
      <RecordPaymentModal
        payment={recording}
        onClose={() => setRecording(null)}
        onDone={() => {
          setRecording(null);
          qc.invalidateQueries();
        }}
      />
    </div>
  );
}
