// Chart conventions (dataviz method): thin marks (<=24px bars, 4px rounded data-end), 2px lines, hairline solid
// grid, one axis, text in ink tokens (never series colour), hover tooltip that leads with the value.
import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { compactINR } from '@/lib/format';

export const CHART = {
  series1: '#2a78d6',
  series2: '#eb6834',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  surface: '#ffffff',
};

const axisTick = { fill: CHART.muted, fontSize: 12 };

function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: TooltipProps<number, string> & { format: (v: number) => string; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
      <p className="mb-1 text-slate-500">{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="font-semibold text-slate-900 tabular">{format(Number(p.value))}</span>
          <span className="text-slate-500">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

interface Series {
  key: string;
  label: string;
  color: string;
}

/** Column chart for one or two (stacked) series over categories such as months. */
export function ColumnChart({
  data,
  xKey,
  series,
  format = (v) => v.toLocaleString('en-IN'),
  axisFormat,
  labelFormat,
  height = 240,
}: {
  data: Record<string, any>[];
  xKey: string;
  series: Series[];
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  labelFormat?: (l: string) => string;
  height?: number;
}) {
  const stacked = series.length > 1;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: CHART.axis }} tick={axisTick} tickFormatter={labelFormat} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={44} allowDecimals={false} tickFormatter={axisFormat ?? ((v: number) => compactINR(v))} />
          <Tooltip cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }} content={<ChartTooltip format={format} labelFormat={labelFormat} />} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? 'stack' : undefined}
              maxBarSize={24}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
              stroke={stacked ? CHART.surface : undefined}
              strokeWidth={stacked ? 2 : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series trend: 2px line with a ~10% wash and a crosshair tooltip. */
export function TrendChart({
  data,
  xKey,
  yKey,
  label,
  format = (v) => v.toLocaleString('en-IN'),
  axisFormat,
  labelFormat,
  height = 240,
}: {
  data: Record<string, any>[];
  xKey: string;
  yKey: string;
  label: string;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  labelFormat?: (l: string) => string;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: CHART.axis }} tick={axisTick} tickFormatter={labelFormat} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={44} tickFormatter={axisFormat ?? ((v: number) => compactINR(v))} />
          <Tooltip cursor={{ stroke: CHART.axis, strokeWidth: 1 }} content={<ChartTooltip format={format} labelFormat={labelFormat} />} />
          <Area
            type="monotone"
            dataKey={yKey}
            name={label}
            stroke={CHART.series1}
            strokeWidth={2}
            fill={CHART.series1}
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, fill: CHART.series1, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars rendered in HTML: label, value at the tip, single series colour. */
export function BarList({ items, format = (v) => v.toLocaleString('en-IN') }: { items: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.label} title={`${it.label}: ${format(it.value)}`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">
              {it.label}
              {it.sub && <span className="ml-1.5 text-xs text-slate-400">{it.sub}</span>}
            </span>
            <span className="shrink-0 font-medium text-slate-900 tabular">{format(it.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: CHART.series1 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Card that shows a chart with a one-click table view of the same data (the accessible twin). */
export function ChartCard({
  title,
  subtitle,
  chart,
  table,
  legend,
  className,
}: {
  title: string;
  subtitle?: string;
  chart: ReactNode;
  table: { headers: string[]; rows: (string | number)[][]; align?: ('left' | 'right')[] };
  legend?: Series[];
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`min-w-0 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${className ?? ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>
      {legend && view === 'chart' && (
        <div className="px-5 pt-3">
          <Legend items={legend} />
        </div>
      )}
      <div className="p-5 pt-3">
        {view === 'chart' ? (
          chart
        ) : (
          <div className="scroll-thin max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {table.headers.map((h, i) => (
                    <th key={h} className={`py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500 ${table.align?.[i] === 'right' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className={`py-2 pr-4 text-slate-700 tabular ${table.align?.[ci] === 'right' ? 'text-right' : 'text-left'}`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function Legend({ items }: { items: Series[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      {items.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}
