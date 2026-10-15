import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, fuelTypeLabel, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Product } from '@/lib/types';
import { ActiveBadge } from '@/components/StatusBadge';
import { Card, DataTable, EmptyState, ErrorState, LinkButton, PageHeader, type Column } from '@/components/ui';

export default function Products() {
  useDocumentTitle('RSA products');
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['admin-products'], queryFn: () => api<Product[]>('/api/admin/rsa/products') });
  const columns: Column<Product>[] = [
    {
      key: 'plan',
      header: 'Plan',
      cell: (p) => (
        <div>
          <p className="font-medium text-slate-900">{p.planName}</p>
          <p className="font-mono text-xs text-slate-500">
            {p.productCode} · on certificate: {p.certificatePlanName ?? p.planName}
          </p>
        </div>
      ),
    },
    {
      key: 'eligibility',
      header: 'Eligibility',
      cell: (p) => (
        <div className="text-xs text-slate-600">
          <p>{p.vehicleTypes.map(vehicleTypeLabel).join(', ')}</p>
          <p className="text-slate-500">
            {p.fuelTypes.length ? p.fuelTypes.map(fuelTypeLabel).join(', ') : 'All fuels'}
            {p.maxVehicleAgeYears !== null ? ` · up to ${p.maxVehicleAgeYears} yrs old` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'terms',
      header: 'Validity & price',
      cell: (p) => (
        <div className="space-y-0.5 text-xs">
          {p.terms
            .filter((t) => t.status === 'ACTIVE')
            .map((t) => (
              <p key={t.id} className="tabular">
                {t.label}: <span className="font-medium text-slate-900">{formatMoney(t.price)}</span>
              </p>
            ))}
          <p className="text-slate-500">
            GST {p.effectiveGstRate}% {p.priceIncludesGst ? 'included' : 'extra'}
          </p>
        </div>
      ),
    },
    { key: 'services', header: 'Services', align: 'right', cell: (p) => p.numberOfServices },
    { key: 'benefits', header: 'Benefits', align: 'right', cell: (p) => p.benefits.length },
    { key: 'dealers', header: 'Dealers', align: 'right', cell: (p) => p.dealerCount ?? 0 },
    { key: 'policies', header: 'Policies', align: 'right', cell: (p) => p.policyCount ?? 0 },
    { key: 'status', header: 'Status', cell: (p) => <ActiveBadge status={p.status} /> },
  ];
  return (
    <div>
      <PageHeader
        title="RSA products"
        subtitle="Plans, validity options, pricing, GST, benefits and conditions used on certificates"
        actions={
          <LinkButton to="/admin/products/new" icon={Plus}>
            New product
          </LinkButton>
        }
      />
      <Card padded={false}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={q.data}
            rowKey={(p) => p.id}
            loading={q.isLoading}
            onRowClick={(p) => navigate(`/admin/products/${p.id}`)}
            empty={<EmptyState icon={Package} title="No products yet" />}
          />
        )}
      </Card>
    </div>
  );
}
