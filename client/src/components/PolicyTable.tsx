import { Link, useNavigate } from 'react-router-dom';
import { FileSearch } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import type { PolicyListItem } from '@/lib/types';
import { PolicyStatusBadge } from './StatusBadge';
import { DataTable, EmptyState, type Column } from './ui';

export function PolicyTable({
  rows,
  loading,
  fetching,
  showDealer,
  empty,
}: {
  rows: PolicyListItem[] | undefined;
  loading?: boolean;
  fetching?: boolean;
  showDealer?: boolean;
  empty?: React.ReactNode;
}) {
  const { base } = useAuth();
  const navigate = useNavigate();
  const columns: Column<PolicyListItem>[] = [
    {
      key: 'number',
      header: 'Certificate No.',
      cell: (p) => (
        <Link to={`${base}/policies/${p.id}`} className="font-mono text-[13px] font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          {p.policyNumber ?? 'Quotation'}
        </Link>
      ),
    },
    ...(showDealer ? [{ key: 'dealer', header: 'Dealer', cell: (p: PolicyListItem) => <span className="text-slate-700">{p.dealerName}</span> }] : []),
    {
      key: 'customer',
      header: 'Customer',
      cell: (p) => (
        <div>
          <p className="font-medium text-slate-900">{p.customerName}</p>
          <p className="text-xs text-slate-500">{p.customerMobile}</p>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (p) => (
        <div>
          <p className="text-slate-800">{p.makeModel}</p>
          <p className="font-mono text-xs text-slate-500">{p.registrationNo ?? 'New'}</p>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', className: 'min-w-36 max-w-48 whitespace-normal', cell: (p) => <span className="text-slate-700">{p.planName}</span> },
    {
      key: 'validity',
      header: 'Validity',
      cell: (p) => (
        <div className="text-xs leading-relaxed text-slate-600 tabular">
          <p>{formatDate(p.startDate)}</p>
          <p className="text-slate-400">to {formatDate(p.endDate)}</p>
        </div>
      ),
    },
    { key: 'premium', header: 'Premium', align: 'right', cell: (p) => <span className="font-medium text-slate-900 tabular">{formatMoney(p.totalPremium)}</span> },
    { key: 'status', header: 'Status', cell: (p) => <PolicyStatusBadge status={p.status} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      loading={loading}
      fetching={fetching}
      onRowClick={(p) => navigate(`${base}/policies/${p.id}`)}
      empty={empty ?? <EmptyState icon={FileSearch} title="No policies found" description="Try a different search or filter." />}
    />
  );
}
