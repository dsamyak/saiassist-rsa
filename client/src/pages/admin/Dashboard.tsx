import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock, Ban, Building2, CalendarX2, FileStack, IndianRupee, Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatMoney, formatMoney0, formatNumber, monthLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { MonthPoint } from '@/lib/types';
import { BarList, CHART, ChartCard, ColumnChart, TrendChart } from '@/components/Charts';
import { Card, ErrorState, LinkButton, PageHeader, PageLoader, StatCard } from '@/components/ui';
import { ActiveBadge } from '@/components/StatusBadge';

interface AdminDashboardData {
  counts: {
    dealers: number;
    active_dealers: number;
    dealer_users: number;
    products: number;
    total: number;
    active: number;
    expiring: number;
    expired: number;
    this_month: number;
    month_premium: number;
    lifetime_premium: number;
    month_gst: number;
    pendingCancellations: number;
  };
  trend: MonthPoint[];
  topDealers: { id: string; dealer_name: string; dealer_code: string; status: string; policies: number; total: number }[];
  productMix: { plan_name: string; policies: number; total: number }[];
}

export default function AdminDashboard() {
  useDocumentTitle('Platform dashboard');
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<AdminDashboardData>('/api/admin/dashboard') });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const c = d.counts;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        subtitle={`${c.active_dealers} active dealers · ${c.dealer_users} dealer users · ${c.products} RSA products`}
        actions={
          <LinkButton to="/admin/dealers/new" icon={Plus}>
            Onboard dealer
          </LinkButton>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Dealers" value={`${c.active_dealers} / ${c.dealers}`} hint="Active / total" icon={Building2} to="/admin/dealers" />
        <StatCard label="Total policies" value={formatNumber(c.total)} icon={FileStack} to="/admin/policies" hint={`${formatNumber(c.this_month)} this month`} />
        <StatCard label="Active policies" value={formatNumber(c.active)} icon={ShieldCheck} tone="green" to="/admin/policies?status=IN_FORCE" />
        <StatCard label="Premium this month" value={formatMoney0(c.month_premium)} icon={IndianRupee} tone="green" hint={`GST ${formatMoney0(c.month_gst)}`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Expiring soon" value={formatNumber(c.expiring)} icon={AlarmClock} tone="amber" to="/admin/policies?status=EXPIRING_SOON" />
        <StatCard label="Expired" value={formatNumber(c.expired)} icon={CalendarX2} tone="slate" to="/admin/policies?status=EXPIRED" />
        <StatCard label="Cancellation requests" value={formatNumber(c.pendingCancellations)} icon={Ban} tone="red" to="/admin/cancellations" hint="Awaiting a decision" />
        <StatCard label="Lifetime premium" value={formatMoney0(c.lifetime_premium)} icon={IndianRupee} tone="violet" hint="All dealers, incl. GST" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Policies issued"
          subtitle="Last 12 months, all dealers"
          chart={<ColumnChart data={d.trend} xKey="month" labelFormat={monthLabel} axisFormat={(v) => String(v)} series={[{ key: 'policies', label: 'Policies', color: CHART.series1 }]} />}
          table={{ headers: ['Month', 'Policies'], align: ['left', 'right'], rows: d.trend.map((m) => [monthLabel(m.month), m.policies]) }}
        />
        <ChartCard
          title="Premium collected"
          subtitle="Last 12 months, including GST"
          chart={<TrendChart data={d.trend} xKey="month" yKey="total" label="Premium" format={formatMoney} labelFormat={monthLabel} />}
          table={{ headers: ['Month', 'Premium'], align: ['left', 'right'], rows: d.trend.map((m) => [monthLabel(m.month), formatMoney(m.total)]) }}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top dealers this month" padded={false} actions={<Link to="/admin/reports" className="text-xs font-medium text-brand-700 hover:underline">Full report</Link>}>
          <ul className="divide-y divide-slate-100">
            {d.topDealers.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <Link to={`/admin/dealers/${x.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {x.dealer_name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {x.dealer_code} · {x.policies} policies
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-slate-900 tabular">{formatMoney0(x.total)}</span>
                  <ActiveBadge status={x.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <ChartCard
          title="Product mix"
          subtitle="Policies by plan, last 12 months"
          chart={<BarList items={d.productMix.map((p) => ({ label: p.plan_name, value: p.policies }))} />}
          table={{ headers: ['Plan', 'Policies', 'Premium'], align: ['left', 'right', 'right'], rows: d.productMix.map((p) => [p.plan_name, p.policies, formatMoney(p.total)]) }}
        />
      </div>
    </div>
  );
}
