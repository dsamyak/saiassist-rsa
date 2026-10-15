import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  BellRing,
  Download,
  FilePen,
  FileSignature,
  History,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Printer,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { AUDIT_ACTION_LABELS } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadFile, openPdf } from '@/lib/files';
import { formatDate, formatDateTime, formatMoney, fuelTypeLabel, paymentMethodLabel, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { AuditEntry, Paged, PolicyDetail as Policy } from '@/lib/types';
import { CancellationStatusBadge, PaymentStatusBadge, PolicyStatusBadge } from '@/components/StatusBadge';
import { CancelPolicyModal, EndorseModal, ReasonModal, RecordPaymentModal } from '@/components/policyActions';
import { Alert, Badge, Button, Card, DL, ErrorState, LinkButton, PageHeader, PageLoader, toast } from '@/components/ui';

export default function PolicyDetail() {
  const { id } = useParams();
  const { base, can, session } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['policy', id], queryFn: () => api<Policy>(`/api/policies/${id}`) });
  const activity = useQuery({
    queryKey: ['policy-activity', id],
    queryFn: () => api<Paged<AuditEntry>>('/api/audit-logs', { query: { entityId: id, pageSize: 30 } }),
    enabled: can('audit.view'),
  });
  const [modal, setModal] = useState<null | 'payment' | 'cancel' | 'approve' | 'reject' | 'request' | 'endorse' | 'suspend' | 'reinstate'>(null);
  useDocumentTitle(q.data?.policyNumber ?? 'Policy');

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const s = p.snapshot;
  const a = p.actions;
  const isDraft = p.storedStatus === 'DRAFT';
  const pendingRequest = p.cancellations.find((c) => c.status === 'REQUESTED');
  const pendingPayment = p.payments.find((x) => x.status === 'PENDING') ?? null;
  const collected = p.payments
    .filter((x) => ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(x.status))
    .reduce((sum, x) => sum + x.totalAmount - x.refundAmount, 0);
  const pdfPath = `/api/policies/${p.id}/pdf`;
  const fileName = `${p.policyNumber ?? 'RSA-Quotation'}.pdf`;
  const done = (updated: Policy) => {
    setModal(null);
    qc.setQueryData(['policy', id], updated);
    qc.invalidateQueries({ queryKey: ['policies'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['cancellations'] });
    qc.invalidateQueries({ queryKey: ['policy-activity', id] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const wa = `https://wa.me/91${s.customer.mobile}?text=${encodeURIComponent(
    [
      'RSA Policy Successfully Issued',
      `Policy No: ${p.policyNumber}`,
      `Vehicle: ${s.vehicle.make} ${s.vehicle.model} (${s.vehicle.registrationNo ?? 'New'})`,
      `Valid From: ${formatDateTime(p.startDate)}`,
      `Valid Till: ${formatDateTime(p.endDate)}`,
      `RSA Helpline: ${s.dealer.rsaPhone}`,
      s.verifyUrl ? `Verify: ${s.verifyUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )}`;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: `${base}/policies`, label: 'Policies' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{p.policyNumber ?? 'Quotation'}</span>
            <PolicyStatusBadge status={p.status} />
          </span>
        }
        subtitle={`${p.planName} · ${p.termLabel} · ${p.dealerName}`}
        actions={
          <>
            {a.canDownload && (
              <>
                <Button variant="secondary" icon={Printer} onClick={() => run(() => openPdf(pdfPath, fileName))}>
                  {isDraft ? 'Quotation PDF' : 'Open / print'}
                </Button>
                {!isDraft && (
                  <Button variant="secondary" icon={Download} onClick={() => run(() => downloadFile(`${pdfPath}?download=1`, fileName))}>
                    Download
                  </Button>
                )}
              </>
            )}
            {a.canIssueDraft && (
              <LinkButton icon={FileSignature} to={`/app/issue?draft=${p.id}`}>
                Issue this quotation
              </LinkButton>
            )}
            {a.canRenew && (
              <LinkButton icon={RefreshCw} to={`/app/issue?renew=${p.id}`}>
                Renew
              </LinkButton>
            )}
          </>
        }
      />

      {p.status === 'PAYMENT_PENDING' && (
        <Alert tone="warning" title="Awaiting payment">
          This certificate number is reserved but the policy is not active until payment is realised.
          {a.canRecordPayment && pendingPayment && (
            <Button size="sm" className="ml-3 mt-2" icon={Wallet} onClick={() => setModal('payment')}>
              Record payment
            </Button>
          )}
        </Alert>
      )}
      {pendingRequest && (
        <Alert tone="warning" title="Cancellation requested">
          {pendingRequest.requestedByName} requested cancellation on {formatDateTime(pendingRequest.requestedAt)}: “{pendingRequest.reason}”
          {a.canCancel && (
            <span className="mt-2 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => setModal('approve')}>
                Approve &amp; cancel
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setModal('reject')}>
                Reject request
              </Button>
            </span>
          )}
        </Alert>
      )}
      {p.renewedTo && (
        <Alert tone="info">
          Renewed by{' '}
          <Link className="font-semibold underline" to={`${base}/policies/${p.renewedTo.id}`}>
            {p.renewedTo.policyNumber}
          </Link>
          . This certificate remains valid until {formatDateTime(p.endDate)}.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Certificate information">
            <DL
              cols={3}
              items={[
                { label: 'Certificate number', value: <span className="font-mono">{p.policyNumber ?? 'Not yet allocated'}</span> },
                { label: 'Start', value: formatDateTime(p.startDate) },
                { label: 'End', value: formatDateTime(p.endDate) },
                { label: 'Plan', value: `${s.plan.planName} (${p.productCode})` },
                { label: 'Plan name on certificate', value: s.plan.certificatePlanName },
                { label: 'Number of services', value: s.plan.numberOfServices },
                { label: 'Issued', value: p.issuedAt ? `${formatDateTime(p.issuedAt)} by ${p.issuedByName ?? '—'}` : 'Not issued' },
                { label: 'Issuer & servicing office', value: s.dealer.issuerName },
                { label: 'RSA helpline', value: s.dealer.rsaPhone },
              ]}
            />
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Card
              title="Certificate holder"
              actions={
                session?.user.role !== 'SUPER_ADMIN' && (
                  <Link to={`/app/customers/${p.customerId}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Customer record
                  </Link>
                )
              }
            >
              <DL
                cols={1}
                items={[
                  { label: 'Name', value: s.customer.name },
                  { label: 'Mobile / Email', value: `${s.customer.mobile}${s.customer.email ? ` · ${s.customer.email}` : ''}` },
                  { label: 'Date of birth', value: s.customer.dob ? formatDate(s.customer.dob) : null },
                  { label: 'Address', value: `${s.customer.address}, ${s.customer.city}, ${s.customer.state} - ${s.customer.pincode}` },
                ]}
              />
            </Card>
            <Card title="Vehicle">
              <DL
                cols={2}
                items={[
                  { label: 'Registration', value: <span className="font-mono">{s.vehicle.registrationNo ?? 'New'}</span> },
                  { label: 'Type', value: vehicleTypeLabel(s.vehicle.vehicleType) },
                  { label: 'Make & model', value: `${s.vehicle.make} ${s.vehicle.model}` },
                  { label: 'Variant', value: s.vehicle.variant },
                  { label: 'Engine no.', value: <span className="font-mono">{s.vehicle.engineNo ?? '—'}</span> },
                  { label: 'Chassis no.', value: <span className="font-mono">{s.vehicle.chassisNo ?? '—'}</span> },
                  { label: 'Fuel', value: fuelTypeLabel(s.vehicle.fuelType) },
                  { label: 'Year', value: s.vehicle.manufacturingYear },
                ]}
              />
            </Card>
          </div>
          <Card title="Roadside assistance coverage" padded={false}>
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">#</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Benefit</th>
                  <th className="hidden px-4 py-2.5 text-left font-semibold sm:table-cell">Description</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Applicable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.plan.benefits.map((b, i) => (
                  <tr key={b.name}>
                    <td className="px-4 py-2.5 text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{b.name}</td>
                    <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{b.description}</td>
                    <td className="px-4 py-2.5 text-slate-700">{b.applicable}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-4 py-2.5 text-slate-500">{s.plan.benefits.length + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">Number of Services</td>
                  <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">during a plan</td>
                  <td className="px-4 py-2.5 text-slate-700">{s.plan.numberOfServices}</td>
                </tr>
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-500">{s.conditions}</p>
          </Card>
          {can('audit.view') && (
            <Card title="Activity" padded={false}>
              {activity.data?.items.length ? (
                <ul className="divide-y divide-slate-100">
                  {activity.data.items.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <History className="mt-0.5 size-4 shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <p className="text-slate-800">
                          <span className="font-medium">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span> by {e.userName ?? 'System'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(e.createdAt)}
                          {e.message ? ` · ${e.message}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-sm text-slate-500">No activity recorded.</p>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Premium">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Base premium</dt>
                <dd className="tabular">{formatMoney(p.basePremium)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>GST @ {p.gstRate}%</dt>
                <dd className="tabular">{formatMoney(p.gstAmount)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
                <dt>Total premium</dt>
                <dd className="tabular">{formatMoney(p.totalPremium)}</dd>
              </div>
            </dl>
          </Card>

          {(a.canEndorse || a.canCancel || a.canRequestCancel || a.canSuspend || a.canReinstate || a.canNotify || a.canDeleteDraft) && (
            <Card title="Actions">
              <div className="flex flex-col gap-2">
                {a.canNotify && (
                  <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                    <MessageCircle className="size-4" /> Share on WhatsApp
                  </a>
                )}
                {a.canNotify && (
                  <Button variant="secondary" icon={BellRing} onClick={() => run(async () => done(await api<Policy>(`/api/policies/${p.id}/notify`, { method: 'POST' })))}>
                    Send notifications again
                  </Button>
                )}
                {a.canEndorse && (
                  <Button variant="secondary" icon={FilePen} onClick={() => setModal('endorse')}>
                    Endorse details
                  </Button>
                )}
                {a.canSuspend && (
                  <Button variant="secondary" icon={PauseCircle} onClick={() => setModal('suspend')}>
                    Suspend policy
                  </Button>
                )}
                {a.canReinstate && (
                  <Button variant="secondary" icon={PlayCircle} onClick={() => setModal('reinstate')}>
                    Reinstate policy
                  </Button>
                )}
                {a.canRequestCancel && (
                  <Button variant="secondary" icon={Ban} onClick={() => setModal('request')}>
                    Request cancellation
                  </Button>
                )}
                {a.canCancel && !pendingRequest && (
                  <Button variant="danger" icon={Ban} onClick={() => setModal('cancel')}>
                    Cancel policy
                  </Button>
                )}
                {a.canDeleteDraft && (
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() =>
                      window.confirm('Delete this quotation?') &&
                      run(async () => {
                        await api(`/api/policies/drafts/${p.id}`, { method: 'DELETE' });
                        toast.success('Quotation deleted');
                        qc.invalidateQueries({ queryKey: ['policies'] });
                        navigate(`${base}/policies?status=DRAFT`);
                      })
                    }
                  >
                    Delete quotation
                  </Button>
                )}
              </div>
            </Card>
          )}

          {p.payments.length > 0 && (
            <Card title="Payments" padded={false}>
              <ul className="divide-y divide-slate-100">
                {p.payments.map((pm) => (
                  <li key={pm.id} className="space-y-1 px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900 tabular">{formatMoney(pm.totalAmount)}</span>
                      <PaymentStatusBadge status={pm.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {paymentMethodLabel(pm.paymentMethod)}
                      {pm.transactionId ? ` · ${pm.transactionId}` : ''} · {pm.paidAt ? formatDateTime(pm.paidAt) : 'not paid'}
                    </p>
                    {pm.refundAmount > 0 && (
                      <p className="text-xs text-violet-700">
                        Refunded {formatMoney(pm.refundAmount)}
                        {pm.refundReference ? ` (${pm.refundReference})` : ''}
                      </p>
                    )}
                    {pm.status === 'PENDING' && a.canRecordPayment && (
                      <Button size="sm" className="mt-1" icon={Wallet} onClick={() => setModal('payment')}>
                        Record payment
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(p.renewedFrom || p.renewedTo) && (
            <Card title="Renewal history">
              <ul className="space-y-2 text-sm">
                {p.renewedFrom && (
                  <li>
                    Renewal of{' '}
                    <Link to={`${base}/policies/${p.renewedFrom.id}`} className="font-mono font-medium text-brand-700 hover:underline">
                      {p.renewedFrom.policyNumber}
                    </Link>
                  </li>
                )}
                {p.renewedTo && (
                  <li>
                    Renewed by{' '}
                    <Link to={`${base}/policies/${p.renewedTo.id}`} className="font-mono font-medium text-brand-700 hover:underline">
                      {p.renewedTo.policyNumber}
                    </Link>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {p.documents.length > 0 && (
            <Card title="Certificate versions" subtitle="Issued documents are preserved and never modified" padded={false}>
              <ul className="divide-y divide-slate-100">
                {p.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        Version {d.version} <Badge tone={d.reason === 'ISSUED' ? 'blue' : 'violet'}>{d.reason === 'ISSUED' ? 'Original' : 'Endorsement'}</Badge>
                      </p>
                      <p className="truncate text-xs text-slate-500" title={`SHA-256 ${d.sha256}`}>
                        {formatDateTime(d.generatedAt)} · {d.generatedByName ?? 'System'} · {Math.round(d.sizeBytes / 1024)} KB
                      </p>
                    </div>
                    {a.canDownload && (
                      <Button size="sm" variant="ghost" icon={Download} onClick={() => run(() => openPdf(`/api/policies/${p.id}/documents/${d.version}`, `${p.policyNumber}-v${d.version}.pdf`))}>
                        Open
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.cancellations.length > 0 && (
            <Card title="Cancellation" padded={false}>
              <ul className="divide-y divide-slate-100">
                {p.cancellations.map((c) => (
                  <li key={c.id} className="space-y-1 px-5 py-3 text-sm">
                    <CancellationStatusBadge status={c.status} />
                    <p className="text-slate-700">{c.reason}</p>
                    <p className="text-xs text-slate-500">
                      Requested by {c.requestedByName} · {formatDateTime(c.requestedAt)}
                      {c.decidedAt ? ` · decided by ${c.approvedByName} on ${formatDateTime(c.decidedAt)}` : ''}
                    </p>
                    {c.refundAmount > 0 && <p className="text-xs text-violet-700">Refund {formatMoney(c.refundAmount)}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.notifications.length > 0 && (
            <Card title="Notifications" padded={false}>
              <ul className="divide-y divide-slate-100">
                {p.notifications.map((n) => (
                  <li key={n.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{n.channel}</span>
                      <Badge tone={n.status === 'SENT' ? 'green' : n.status === 'FAILED' ? 'red' : 'gray'}>{n.status === 'SKIPPED' ? 'Not configured' : n.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      {n.recipient} · {formatDateTime(n.createdAt)}
                    </p>
                    {n.error && <p className="text-xs text-slate-400">{n.error}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <RecordPaymentModal payment={modal === 'payment' ? pendingPayment && { ...pendingPayment, policyNumber: p.policyNumber } : null} onClose={() => setModal(null)} onDone={done} />
      <CancelPolicyModal
        target={
          modal === 'cancel' || modal === 'approve'
            ? {
                policyId: p.id,
                policyNumber: p.policyNumber,
                maxRefund: Math.round(collected * 100) / 100,
                requestId: modal === 'approve' ? pendingRequest?.id : undefined,
                reason: modal === 'approve' ? pendingRequest?.reason : undefined,
              }
            : null
        }
        onClose={() => setModal(null)}
        onDone={done}
      />
      <ReasonModal
        open={modal === 'reject'}
        title="Reject cancellation request"
        confirmLabel="Reject request"
        label="Note to the requester"
        onClose={() => setModal(null)}
        onSubmit={async (notes) => {
          done(await api<Policy>(`/api/cancellations/${pendingRequest!.id}/reject`, { method: 'POST', body: { notes } }));
          toast.success('Request rejected');
        }}
      />
      <ReasonModal
        open={modal === 'request'}
        title="Request cancellation"
        description="Your Dealer Admin will review and approve the cancellation and any refund."
        confirmLabel="Send request"
        onClose={() => setModal(null)}
        onSubmit={async (reason) => {
          done(await api<Policy>(`/api/policies/${p.id}/cancel-request`, { method: 'POST', body: { reason } }));
          toast.success('Cancellation request sent');
        }}
      />
      <ReasonModal
        open={modal === 'suspend' || modal === 'reinstate'}
        title={modal === 'suspend' ? 'Suspend policy' : 'Reinstate policy'}
        description={modal === 'suspend' ? 'Suspended certificates are stamped SUSPENDED and fail verification until reinstated.' : undefined}
        confirmLabel={modal === 'suspend' ? 'Suspend' : 'Reinstate'}
        danger={modal === 'suspend'}
        onClose={() => setModal(null)}
        onSubmit={async (reason) => {
          done(await api<Policy>(`/api/policies/${p.id}/${modal}`, { method: 'POST', body: { reason } }));
          toast.success(modal === 'suspend' ? 'Policy suspended' : 'Policy reinstated');
        }}
      />
      {a.canEndorse && <EndorseModal policy={p} open={modal === 'endorse'} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
