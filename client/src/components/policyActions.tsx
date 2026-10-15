import { useState } from 'react';
import { INDIAN_STATES, PAYMENT_METHODS } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Payment, PolicyDetail } from '@/lib/types';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea, toast } from './ui';

const REF_REQUIRED = ['UPI', 'CARD', 'NET_BANKING', 'CHEQUE'];

export function RecordPaymentModal({ payment, onClose, onDone }: { payment: Payment | null; onClose: () => void; onDone: (p: PolicyDetail) => void }) {
  const [status, setStatus] = useState<'SUCCESS' | 'FAILED'>('SUCCESS');
  const [method, setMethod] = useState(payment?.paymentMethod ?? 'UPI');
  const [ref, setRef] = useState(payment?.transactionId ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (payment && payment.id !== lastId) {
    setLastId(payment.id);
    setMethod(payment.paymentMethod);
    setRef(payment.transactionId ?? '');
    setStatus('SUCCESS');
    setNotes('');
    setError(null);
  }
  const needsRef = status === 'SUCCESS' && REF_REQUIRED.includes(method);
  const submit = async () => {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<PolicyDetail>(`/api/payments/${payment.id}`, {
        method: 'PATCH',
        body: { status, method, transactionId: ref || null, notes: notes || null },
      });
      toast.success(status === 'SUCCESS' ? 'Payment recorded - certificate is now active' : 'Payment marked as failed');
      onDone(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!payment}
      onClose={onClose}
      title="Record payment"
      description={payment ? `${payment.policyNumber ?? ''} · amount ${formatMoney(payment.totalAmount)}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={needsRef && !ref.trim()} onClick={submit} variant={status === 'FAILED' ? 'danger' : 'primary'}>
            {status === 'SUCCESS' ? 'Confirm payment received' : 'Mark as failed'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={status === 'SUCCESS'} onChange={() => setStatus('SUCCESS')} className="accent-brand-700" /> Payment received
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={status === 'FAILED'} onChange={() => setStatus('FAILED')} className="accent-brand-700" /> Payment failed
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transaction / reference no." required={needsRef}>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function CancelPolicyModal({
  target,
  onClose,
  onDone,
}: {
  target: { policyId: string; policyNumber: string | null; maxRefund: number; requestId?: string; reason?: string } | null;
  onClose: () => void;
  onDone: (p: PolicyDetail) => void;
}) {
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('0');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = target ? `${target.policyId}:${target.requestId ?? ''}` : null;
  if (target && k !== key) {
    setKey(k);
    setReason(target.reason ? `Approved: ${target.reason}` : '');
    setRefund(String(target.maxRefund));
    setRef('');
    setError(null);
  }
  const amount = Number(refund) || 0;
  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<PolicyDetail>(`/api/policies/${target.policyId}/cancel`, {
        method: 'POST',
        body: { reason, refundAmount: amount, refundReference: ref || null, requestId: target.requestId ?? null },
      });
      toast.success(`Policy ${target.policyNumber ?? ''} cancelled`);
      onDone(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target?.requestId ? 'Approve cancellation' : 'Cancel policy'}
      description={target?.policyNumber ?? ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep policy
          </Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim() || amount < 0 || amount > (target?.maxRefund ?? 0)} onClick={submit}>
            Cancel policy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">The certificate will be marked CANCELLED on every copy and in public verification. This cannot be undone.</Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Cancellation reason" required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Refund amount (₹)" hint={`Collected: ${formatMoney(target?.maxRefund ?? 0)}`} error={amount > (target?.maxRefund ?? 0) ? 'Cannot exceed the amount collected' : null}>
            <Input type="number" min={0} step="0.01" value={refund} onChange={(e) => setRefund(e.target.value)} />
          </Field>
          <Field label="Refund reference">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / cheque no." disabled={amount === 0} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function ReasonModal({
  open,
  title,
  description,
  confirmLabel,
  danger,
  label = 'Reason',
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  label?: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={() => {
        setReason('');
        setError(null);
        onClose();
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={!reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit(reason);
                setReason('');
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={label} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function EndorseModal({ policy, open, onClose, onDone }: { policy: PolicyDetail; open: boolean; onClose: () => void; onDone: (p: PolicyDetail) => void }) {
  const s = policy.snapshot;
  const init = () => ({
    registrationNo: s.vehicle.registrationNo ?? '',
    mobile: s.customer.mobile,
    email: s.customer.email ?? '',
    address: s.customer.address,
    city: s.customer.city,
    state: s.customer.state,
    pincode: s.customer.pincode,
    reason: '',
  });
  const [f, setF] = useState(init);
  const [stillNew, setStillNew] = useState(!s.vehicle.registrationNo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { reason: f.reason };
    const reg = stillNew ? null : f.registrationNo.toUpperCase().replace(/[\s-]/g, '');
    if (reg !== (s.vehicle.registrationNo ?? null)) body.registrationNo = reg;
    if (f.mobile !== s.customer.mobile) body.mobile = f.mobile;
    if ((f.email || null) !== (s.customer.email ?? null)) body.email = f.email || null;
    (['address', 'city', 'state', 'pincode'] as const).forEach((k) => {
      if (f[k] !== s.customer[k]) body[k] = f[k];
    });
    try {
      const p = await api<PolicyDetail>(`/api/policies/${policy.id}/endorse`, { method: 'POST', body });
      toast.success('Endorsement issued - a new certificate version was generated');
      onDone(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Endorse certificate"
      description="Correct non-critical details. The original certificate is preserved and a new version is issued."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!f.reason.trim()} onClick={submit}>
            Issue endorsement
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Alert tone="info">Name, chassis, engine, plan, dates and premium cannot be endorsed. Cancel and re-issue the policy instead.</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Registration number">
              <Input value={stillNew ? '' : f.registrationNo} disabled={stillNew} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} placeholder={stillNew ? 'New' : 'e.g. MH09AB1234'} className="uppercase" />
            </Field>
            <Checkbox className="mt-2" label="Registration still pending (print as New)" checked={stillNew} onChange={(e) => setStillNew(e.target.checked)} />
          </div>
          <Field label="Mobile">
            <Input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
          <Field label="City">
            <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </Field>
          <Field label="State">
            <Select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
              {INDIAN_STATES.map((st) => (
                <option key={st}>{st}</option>
              ))}
            </Select>
          </Field>
          <Field label="Pincode">
            <Input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} maxLength={6} />
          </Field>
          <Field label="Reason for endorsement" required className="sm:col-span-2">
            <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. RTO registration completed" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
