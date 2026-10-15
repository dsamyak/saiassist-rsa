import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Cancellation, PolicyDetail } from '@/lib/types';
import { CancellationStatusBadge } from '@/components/StatusBadge';
import { CancelPolicyModal, ReasonModal } from '@/components/policyActions';
import { Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Tabs, toast, type Column } from '@/components/ui';

type Tab = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export default function Cancellations() {
  useDocumentTitle('Cancellations');
  const { session, base } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [approve, setApprove] = useState<Cancellation | null>(null);
  const [reject, setReject] = useState<Cancellation | null>(null);
  const q = useQuery({ queryKey: ['cancellations', tab], queryFn: () => api<Cancellation[]>('/api/cancellations', { query: { status: tab } }) });
  const counts = useQuery({ queryKey: ['cancellations', 'pending-count'], queryFn: () => api<Cancellation[]>('/api/cancellations', { query: { status: 'REQUESTED' } }) });
  const policy = useQuery({
    queryKey: ['policy', approve?.policyId],
    queryFn: () => api<PolicyDetail>(`/api/policies/${approve!.policyId}`),
    enabled: !!approve,
  });
  const collected =
    policy.data?.payments.filter((x) => ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(x.status)).reduce((s, x) => s + x.totalAmount - x.refundAmount, 0) ?? 0;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['cancellations'] });
    qc.invalidateQueries({ queryKey: ['policies'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const columns: Column<Cancellation>[] = [
    {
      key: 'policy',
      header: 'Policy',
      cell: (c) => (
        <Link to={`${base}/policies/${c.policyId}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline">
          {c.policyNumber}
        </Link>
      ),
    },
    ...(isSuper ? [{ key: 'dealer', header: 'Dealer', cell: (c: Cancellation) => c.dealerName }] : []),
    { key: 'customer', header: 'Customer', cell: (c) => c.customerName },
    { key: 'reason', header: 'Reason', className: 'max-w-xs whitespace-normal', cell: (c) => <span className="text-slate-700">{c.reason}</span> },
    {
      key: 'requested',
      header: 'Requested',
      cell: (c) => (
        <div>
          <p>{c.requestedByName}</p>
          <p className="text-xs text-slate-500">{formatDateTime(c.requestedAt)}</p>
        </div>
      ),
    },
    { key: 'premium', header: 'Premium', align: 'right', cell: (c) => <span className="tabular">{formatMoney(c.totalPremium)}</span> },
    ...(tab !== 'REQUESTED'
      ? [
          { key: 'refund', header: 'Refund', align: 'right' as const, cell: (c: Cancellation) => <span className="tabular">{formatMoney(c.refundAmount)}</span> },
          {
            key: 'decided',
            header: 'Decided',
            cell: (c: Cancellation) => (
              <div>
                <p>{c.approvedByName}</p>
                <p className="text-xs text-slate-500">{formatDateTime(c.decidedAt)}</p>
              </div>
            ),
          },
        ]
      : []),
    { key: 'status', header: 'Status', cell: (c) => <CancellationStatusBadge status={c.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) =>
        c.status === 'REQUESTED' ? (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="danger" onClick={() => setApprove(c)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReject(c)}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];
  return (
    <div>
      <PageHeader title="Cancellations" subtitle="Approve or reject cancellation requests raised by staff, and review past cancellations" />
      <Tabs
        tabs={[
          { key: 'REQUESTED', label: 'Pending approval', count: counts.data?.length },
          { key: 'APPROVED', label: 'Cancelled' },
          { key: 'REJECTED', label: 'Rejected' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />
      <Card padded={false}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={q.data}
            rowKey={(c) => c.id}
            loading={q.isLoading}
            empty={<EmptyState icon={Ban} title={tab === 'REQUESTED' ? 'No pending requests' : 'Nothing here'} description={tab === 'REQUESTED' ? 'Requests from employees will appear here for approval.' : undefined} />}
          />
        )}
      </Card>
      <CancelPolicyModal
        target={approve && policy.data ? { policyId: approve.policyId, policyNumber: approve.policyNumber ?? null, maxRefund: Math.round(collected * 100) / 100, requestId: approve.id, reason: approve.reason } : null}
        onClose={() => setApprove(null)}
        onDone={() => {
          setApprove(null);
          refresh();
        }}
      />
      <ReasonModal
        open={!!reject}
        title="Reject cancellation request"
        label="Note to the requester"
        confirmLabel="Reject request"
        onClose={() => setReject(null)}
        onSubmit={async (notes) => {
          await api(`/api/cancellations/${reject!.id}/reject`, { method: 'POST', body: { notes } });
          toast.success('Request rejected');
          setReject(null);
          refresh();
        }}
      />
    </div>
  );
}
