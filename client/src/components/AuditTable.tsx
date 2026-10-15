import { useState } from 'react';
import { AUDIT_ACTION_LABELS, ROLE_LABELS, type Role } from '@shared/constants';
import { formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { Badge, Button, DataTable, EmptyState, Modal, type Column } from './ui';
import { ScrollText } from 'lucide-react';

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-sm text-slate-400">—</p>;
  return <pre className="scroll-thin max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">{JSON.stringify(value, null, 2)}</pre>;
}

export function AuditTable({ rows, loading, fetching, showDealer }: { rows: AuditEntry[] | undefined; loading?: boolean; fetching?: boolean; showDealer?: boolean }) {
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const columns: Column<AuditEntry>[] = [
    { key: 'time', header: 'Date & time', cell: (a) => <span className="text-xs text-slate-600 tabular">{formatDateTime(a.createdAt)}</span> },
    {
      key: 'user',
      header: 'User',
      cell: (a) => (
        <div>
          <p className="text-slate-800">{a.userName ?? 'System'}</p>
          {a.userRole && <p className="text-xs text-slate-500">{ROLE_LABELS[a.userRole as Role] ?? a.userRole}</p>}
        </div>
      ),
    },
    ...(showDealer ? [{ key: 'dealer', header: 'Dealer', cell: (a: AuditEntry) => <span className="text-slate-600">{a.dealerName ?? 'Platform'}</span> }] : []),
    { key: 'action', header: 'Action', cell: (a) => <span className="font-medium text-slate-900">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</span> },
    { key: 'entity', header: 'Record', cell: (a) => <span className="font-mono text-xs text-slate-600">{a.entityLabel ?? '—'}</span> },
    {
      key: 'result',
      header: 'Result',
      cell: (a) => <Badge tone={a.result === 'SUCCESS' ? 'green' : 'red'}>{a.result === 'SUCCESS' ? 'Success' : 'Failure'}</Badge>,
    },
    {
      key: 'details',
      header: '',
      align: 'right',
      cell: (a) =>
        a.oldValue || a.newValue || a.message ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>
            Details
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} loading={loading} fetching={fetching} empty={<EmptyState icon={ScrollText} title="No audit entries" />} />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? AUDIT_ACTION_LABELS[open.action] ?? open.action : ''} description={open ? `${formatDateTime(open.createdAt)} · ${open.userName ?? 'System'}${open.ipAddress ? ` · IP ${open.ipAddress}` : ''}` : ''} size="lg">
        {open && (
          <div className="space-y-4">
            {open.message && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Note</p>
                <p className="text-sm text-slate-800">{open.message}</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Before</p>
                <Json value={open.oldValue} />
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">After</p>
                <Json value={open.newValue} />
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
