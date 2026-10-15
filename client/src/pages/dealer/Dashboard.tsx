import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlarmClock, Ban, CalendarCheck2, CalendarX2, FilePlus2, FileStack, Hourglass, IndianRupee, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatMoney0, formatNumber, monthLabel, todayIst } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { MonthPoint, PolicyListItem } from '@/lib/types';
import { ChartCard, ColumnChart, CHART } from '@/components/Charts';
import { PolicyTable } from '@/components/PolicyTable';
import { Card, ErrorState, LinkButton, PageHeader, PageLoader, StatCard } from '@/components/ui';

interface DealerDashboardData {
  counts: {
    total: number;
    active: number;
    expiring: number;
    expired: number;
    today: number;
    this_month: number;
    month_premium: number;
    payment_pending: number;
    drafts: number;
    pendingCancellations: number;
  };
  recent: PolicyListItem[];
  expiringSoon: PolicyListItem[];
  trend: MonthPoint[];
  expiringSoonDays: number;
}

export default function DealerDashboard() {
  useDocumentTitle('Dashboard');
  const { session, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DealerDashboardData>('/api/dashboard') });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const c = d.counts;
  const canIssue = can('policies.issue');
  const canView = can('policies.view');
  const link = (status: string) => (canView ? `/app/policies?status=${status}` : undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${session?.user.name.split(' ')[0]}`}
        subtitle={`${session?.dealer?.name} · ${formatDate(todayIst())}`}
        actions={
          canIssue && (
            <LinkButton to="/app/issue" icon={FilePlus2} size="lg">
              Issue RSA Policy
            </LinkButton>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total policies" value={formatNumber(c.total)} icon={FileStack} to={canView ? '/app/policies' : undefined} hint="All issued certificates" />
        <StatCard label="Active policies" value={formatNumber(c.active)} icon={ShieldCheck} tone="green" to={link('IN_FORCE')} hint="Currently in force" />
        <StatCard label="Expiring soon" value={formatNumber(c.expiring)} icon={AlarmClock} tone="amber" to={link('EXPIRING_SOON')} hint={`Within ${d.expiringSoonDays} days`} />
        <StatCard label="Expired" value={formatNumber(c.expired)} icon={CalendarX2} tone="slate" to={link('EXPIRED')} hint="Due for renewal" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's policies" value={formatNumber(c.today)} icon={CalendarCheck2} tone="violet" />
        <StatCard label="This month" value={formatNumber(c.this_month)} icon={RefreshCw} hint="Policies issued since the 1st" />
        <StatCard label="Premium this month" value={formatMoney0(c.month_premium)} icon={IndianRupee} tone="green" hint="Including GST" />
        {can('policies.cancel') && c.pendingCancellations > 0 ? (
          <StatCard label="Cancellation requests" value={formatNumber(c.pendingCancellations)} icon={Ban} tone="red" to="/app/cancellations" hint="Awaiting your approval" />
        ) : (
          <StatCard label="Payment pending" value={formatNumber(c.payment_pending)} icon={Hourglass} tone="amber" to={link('PAYMENT_PENDING')} hint="Certificates awaiting payment" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Policies issued"
          subtitle="Last 6 months"
          chart={
            <ColumnChart
              data={d.trend}
              xKey="month"
              series={[{ key: 'policies', label: 'Policies', color: CHART.series1 }]}
              labelFormat={monthLabel}
              axisFormat={(v) => String(v)}
            />
          }
          table={{
            headers: ['Month', 'Policies', 'Premium'],
            align: ['left', 'right', 'right'],
            rows: d.trend.map((m) => [monthLabel(m.month), m.policies, formatMoney(m.total)]),
          }}
        />
        <Card
          className="lg:col-span-2"
          title="Expiring soon"
          subtitle={`Policies ending in the next ${d.expiringSoonDays} days`}
          padded={false}
          actions={
            canView && (
              <Link to="/app/policies?status=EXPIRING_SOON" className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            )
          }
        >
          {d.expiringSoon.length ? (
            <ul className="divide-y divide-slate-100">
              {d.expiringSoon.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link to={`/app/policies/${p.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                      {p.customerName}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {p.makeModel} · {p.registrationNo ?? 'New'} · ends {formatDate(p.endDate)}
                    </p>
                  </div>
                  {can('policies.renew') && (
                    <LinkButton to={`/app/issue?renew=${p.id}`} size="sm" variant="outline" icon={RefreshCw}>
                      Renew
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No policies are expiring soon.</p>
          )}
        </Card>
      </div>

      <Card
        title="Recent policies"
        padded={false}
        actions={
          canView && (
            <Link to="/app/policies" className="text-xs font-medium text-brand-700 hover:underline">
              View all policies
            </Link>
          )
        }
      >
        <PolicyTable rows={d.recent} />
      </Card>
    </div>
  );
}
