import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlarmClock, Ban, CalendarX2, Download, FileStack, Percent, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, errorMessage, toQueryString } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/files';
import { addDays, formatDate, formatMoney, formatMoney0, formatNumber, monthLabel, monthStart, percent, todayIst } from '@/lib/format';
import { useDocumentTitle, useUrlState } from '@/lib/hooks';
import type { Dealer, MonthPoint, Paged } from '@/lib/types';
import { BarList, CHART, ChartCard, ColumnChart, TrendChart } from '@/components/Charts';
import { Button, Card, DataTable, ErrorState, Field, Input, PageHeader, PageLoader, Select, StatCard, cn, toast, type Column } from '@/components/ui';
import { ROLE_LABELS, type Role } from '@shared/constants';

interface ReportData {
  range: { from: string; to: string };
  summary: {
    issued: number;
    renewals: number;
    premium: number;
    gst: number;
    total: number;
    active: number;
    expiring: number;
    expired: number;
    payment_pending: number;
    cancellations: number;
    refunds: number;
    net: number;
    dueForRenewal: number;
    renewedOfDue: number;
    renewalRate: number | null;
    cancellationRate: number | null;
  };
  productWise: { product_id: string; plan_name: string; policies: number; premium: number; gst: number; total: number }[];
  employeeWise: { user_id: string; name: string; role: string; dealer_name: string; policies: number; total: number }[];
  monthly: (MonthPoint & { gst: number; renewals: number })[];
  dealerWise: { dealer_id: string; dealer_code: string; dealer_name: string; status: string; issued: number; total: number; gst: number; active: number; renewals: number; cancelled: number }[];
}

function fyStart(today: string) {
  const [y, m] = today.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

const PRESETS: { key: string; label: string; range?: (t: string) => [string, string] }[] = [
  { key: 'mtd', label: 'This month', range: (t) => [monthStart(t), t] },
  { key: '30d', label: 'Last 30 days', range: (t) => [addDays(t, -29), t] },
  { key: '90d', label: 'Last 90 days', range: (t) => [addDays(t, -89), t] },
  { key: 'fy', label: 'This financial year', range: (t) => [fyStart(t), t] },
  { key: '12m', label: 'Last 12 months', range: (t) => [monthStart(addDays(monthStart(t), -335)), t] },
  { key: 'custom', label: 'Custom range' },
];

export default function Reports() {
  useDocumentTitle('Reports');
  const { session } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  const today = todayIst();
  const [f, setF] = useUrlState({ preset: '12m', from: '', to: '', dealerId: '' });
  const preset = PRESETS.find((p) => p.key === f.preset) ?? PRESETS[4];
  const [from, to] = preset.range ? preset.range(today) : [f.from || monthStart(today), f.to || today];
  const params = { from, to, dealerId: f.dealerId };
  const q = useQuery({
    queryKey: ['report', params],
    queryFn: () => api<ReportData>('/api/reports/summary', { query: params }),
    placeholderData: keepPreviousData,
  });
  const dealers = useQuery({ queryKey: ['dealers-filter'], queryFn: () => api<Paged<Dealer>>('/api/admin/dealers', { query: { pageSize: 200 } }), enabled: isSuper });

  const exportCsv = async () => {
    try {
      await downloadFile(`/api/policies/export${toQueryString({ from, to, dealerId: f.dealerId })}`, `rsa-policies-${from}-to-${to}.csv`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const d = q.data;
  const s = d?.summary;
  const monthly = (d?.monthly ?? []).map((m) => ({ ...m, newPolicies: m.policies - (m.renewals ?? 0) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={isSuper ? 'Consolidated reports' : 'Reports'}
        subtitle={`${formatDate(from)} to ${formatDate(to)}${isSuper && f.dealerId ? ' · filtered by dealer' : ''}`}
        actions={
          <Button variant="secondary" icon={Download} onClick={exportCsv}>
            Export policies (CSV)
          </Button>
        }
      />

      {/* One filter row scopes every number and chart below */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setF({ preset: p.key, ...(p.key === 'custom' ? { from, to } : { from: '', to: '' }) })}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', p.key === preset.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset.key === 'custom' && (
          <>
            <Field label="From">
              <Input type="date" value={from} max={to} onChange={(e) => setF({ from: e.target.value })} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} min={from} max={today} onChange={(e) => setF({ to: e.target.value })} />
            </Field>
          </>
        )}
        {isSuper && (
          <Field label="Dealer" className="min-w-56">
            <Select value={f.dealerId} onChange={(e) => setF({ dealerId: e.target.value })}>
              <option value="">All dealers</option>
              {dealers.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.dealerName}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !s ? (
        <PageLoader />
      ) : (
        <div className={cn('space-y-6 transition-opacity', q.isFetching && 'opacity-60')}>
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:col-span-1">
              <p className="text-sm text-slate-500">Total sales (incl. GST)</p>
              <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900">{formatMoney0(s.total)}</p>
              <dl className="mt-6 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Premium (excl. GST)</dt>
                  <dd className="font-medium text-slate-900 tabular">{formatMoney(s.premium)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">GST collected</dt>
                  <dd className="font-medium text-slate-900 tabular">{formatMoney(s.gst)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Refunds on cancellations</dt>
                  <dd className="font-medium text-slate-900 tabular">− {formatMoney(s.refunds)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <dt className="font-medium text-slate-700">Net sales</dt>
                  <dd className="font-semibold text-slate-900 tabular">{formatMoney(s.net)}</dd>
                </div>
              </dl>
              {s.payment_pending > 0 && <p className="mt-4 text-xs text-slate-500">{s.payment_pending} policy(ies) awaiting payment are excluded.</p>}
            </section>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <StatCard label="Policies issued" value={formatNumber(s.issued)} icon={FileStack} hint="In the selected period" />
              <StatCard label="Renewals" value={formatNumber(s.renewals)} icon={RefreshCw} tone="violet" hint={`Renewal rate ${percent(s.renewalRate)} of ${s.dueForRenewal} due`} />
              <StatCard label="Cancellations" value={formatNumber(s.cancellations)} icon={Ban} tone="red" hint={`Cancellation rate ${percent(s.cancellationRate)}`} />
              <StatCard label="Active policies" value={formatNumber(s.active)} icon={ShieldCheck} tone="green" hint="In force today" />
              <StatCard label="Expiring soon" value={formatNumber(s.expiring)} icon={AlarmClock} tone="amber" hint="Renewal opportunities" />
              <StatCard label="Expired" value={formatNumber(s.expired)} icon={CalendarX2} tone="slate" hint="Not yet renewed" />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Policies issued by month"
              subtitle="New policies and renewals"
              legend={[
                { key: 'newPolicies', label: 'New', color: CHART.series1 },
                { key: 'renewals', label: 'Renewals', color: CHART.series2 },
              ]}
              chart={
                <ColumnChart
                  data={monthly}
                  xKey="month"
                  labelFormat={monthLabel}
                  axisFormat={(v) => String(v)}
                  series={[
                    { key: 'newPolicies', label: 'New', color: CHART.series1 },
                    { key: 'renewals', label: 'Renewals', color: CHART.series2 },
                  ]}
                />
              }
              table={{
                headers: ['Month', 'New', 'Renewals', 'Total'],
                align: ['left', 'right', 'right', 'right'],
                rows: monthly.map((m) => [monthLabel(m.month), m.newPolicies, m.renewals ?? 0, m.policies]),
              }}
            />
            <ChartCard
              title="Sales by month"
              subtitle="Total premium including GST"
              chart={<TrendChart data={monthly} xKey="month" yKey="total" label="Sales" format={formatMoney} labelFormat={monthLabel} />}
              table={{
                headers: ['Month', 'Policies', 'GST', 'Total sales'],
                align: ['left', 'right', 'right', 'right'],
                rows: monthly.map((m) => [monthLabel(m.month), m.policies, formatMoney(m.gst ?? 0), formatMoney(m.total)]),
              }}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Product-wise sales"
              subtitle="Total premium by RSA plan"
              chart={<BarList format={formatMoney0} items={d.productWise.map((p) => ({ label: p.plan_name, value: p.total, sub: `${p.policies} policies` }))} />}
              table={{
                headers: ['Plan', 'Policies', 'Premium', 'GST', 'Total'],
                align: ['left', 'right', 'right', 'right', 'right'],
                rows: d.productWise.map((p) => [p.plan_name, p.policies, formatMoney(p.premium), formatMoney(p.gst), formatMoney(p.total)]),
              }}
            />
            <Card title="Employee-wise issuance" subtitle="Policies issued by each user" padded={false}>
              <EmployeeTable rows={d.employeeWise} showDealer={isSuper && !f.dealerId} />
            </Card>
          </div>

          {isSuper && !f.dealerId && d.dealerWise.length > 0 && (
            <ChartCard
              title="Dealer-wise performance"
              subtitle="Issuance and revenue by dealer for the period"
              chart={<BarList format={formatMoney0} items={d.dealerWise.map((x) => ({ label: x.dealer_name, value: x.total, sub: `${x.issued} issued` }))} />}
              table={{
                headers: ['Dealer', 'Issued', 'Renewals', 'Cancelled', 'Active now', 'GST', 'Revenue'],
                align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
                rows: d.dealerWise.map((x) => [`${x.dealer_name} (${x.dealer_code})`, x.issued, x.renewals, x.cancelled, x.active, formatMoney(x.gst), formatMoney(x.total)]),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EmployeeTable({ rows, showDealer }: { rows: ReportData['employeeWise']; showDealer: boolean }) {
  const columns: Column<ReportData['employeeWise'][number]>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[r.role as Role] ?? r.role}</p>
        </div>
      ),
    },
    ...(showDealer ? [{ key: 'dealer', header: 'Dealer', cell: (r: ReportData['employeeWise'][number]) => r.dealer_name }] : []),
    { key: 'policies', header: 'Policies', align: 'right', cell: (r) => <span className="tabular">{r.policies}</span> },
    { key: 'total', header: 'Sales', align: 'right', cell: (r) => <span className="font-medium tabular">{formatMoney(r.total)}</span> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.user_id} empty={<p className="py-8 text-center text-sm text-slate-500">No policies issued in this period.</p>} />;
}
