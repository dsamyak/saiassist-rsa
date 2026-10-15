import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, ImageUp, Lock } from 'lucide-react';
import { INDIAN_STATES } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { imageToPngDataUrl, openPdf } from '@/lib/files';
import { useDocumentTitle } from '@/lib/hooks';
import type { Dealer } from '@/lib/types';
import { Alert, Button, Card, DL, ErrorState, Field, Input, PageHeader, PageLoader, Select, Switch, Textarea, toast } from '@/components/ui';

export default function DealerSettings() {
  useDocumentTitle('Dealer settings');
  const { reload } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dealer-settings'], queryFn: () => api<Dealer>('/api/dealer/settings') });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const editable = new Set(d.settings.editableSections);
  const save = async (body: Record<string, unknown>) => {
    try {
      await api('/api/dealer/settings', { method: 'PUT', body });
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['dealer-settings'] });
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dealer settings"
        subtitle="Branding and details printed on your RSA certificates"
        actions={
          <Button variant="secondary" icon={Eye} onClick={() => openPdf('/api/dealer/certificate-preview', 'sample.pdf').catch((e) => toast.error(errorMessage(e)))}>
            Preview certificate
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Certificate issuer" subtitle="Managed by the platform administrator">
          <DL
            items={[
              { label: 'Dealer', value: `${d.dealerName} (${d.dealerCode})` },
              { label: 'Legal / company name', value: d.legalName },
              { label: 'Certificate issuer', value: d.issuerName },
              { label: 'GSTIN', value: d.gstin },
              { label: 'Servicing office', value: <span className="whitespace-pre-line">{d.servicingOffice}</span>, full: true },
              { label: 'Certificate numbering', value: d.policyNumberFormat ? `${d.policyNumberFormat} (prefix ${d.policyPrefix})` : 'Platform default format' },
            ]}
          />
        </Card>
        <LogoCard dealer={d} editable={editable.has('logo')} onSave={(logo) => save({ logo })} />
        <ContactCard dealer={d} editable={editable.has('contact')} onSave={save} />
        <RsaContactCard dealer={d} editable={editable.has('rsaContact')} onSave={save} />
        {d.allowCustomConditions && <ConditionsCard dealer={d} editable={editable.has('conditions')} onSave={save} />}
        <NotificationsCard dealer={d} editable={editable.has('notifications')} onSave={save} />
      </div>
    </div>
  );
}

function Locked({ children }: { children?: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-1.5 text-xs font-medium text-slate-500">
      <Lock className="size-3.5" /> {children ?? 'Only the platform administrator can change this section.'}
    </p>
  );
}

function LogoCard({ dealer, editable, onSave }: { dealer: Dealer; editable: boolean; onSave: (dataUrl: string) => Promise<void> }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Logo" subtitle="Shown at the top-left of every certificate">
      {!editable && <Locked />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid h-24 w-56 place-items-center rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          {preview || dealer.logoUrl ? <img src={preview ?? dealer.logoUrl!} alt="Dealer logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
        </div>
        {editable && (
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
              <ImageUp className="size-4" /> Choose image
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setError(null);
                  try {
                    setPreview(await imageToPngDataUrl(f));
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              />
            </label>
            <p className="text-xs text-slate-500">PNG or JPG, ideally a wide logo (about 3:1).</p>
            {preview && (
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  await onSave(preview);
                  setBusy(false);
                  setPreview(null);
                }}
              >
                Save logo
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Card>
  );
}

function ContactCard({ dealer, editable, onSave }: { dealer: Dealer; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({
    address: dealer.address ?? '',
    city: dealer.city ?? '',
    state: dealer.state ?? 'Maharashtra',
    pincode: dealer.pincode ?? '',
    phone: dealer.phone ?? '',
    email: dealer.email ?? '',
    website: dealer.website ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Dealer contact details">
      {!editable && <Locked />}
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} onChange={set('address')} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={set('city')} />
        </Field>
        <Field label="State">
          <Select value={f.state} onChange={set('state')}>
            {INDIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Pincode">
          <Input value={f.pincode} onChange={set('pincode')} maxLength={6} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Website">
          <Input value={f.website} onChange={set('website')} />
        </Field>
      </fieldset>
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(f);
              setBusy(false);
            }}
          >
            Save contact details
          </Button>
        </div>
      )}
    </Card>
  );
}

function RsaContactCard({ dealer, editable, onSave }: { dealer: Dealer; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ rsaPhone: dealer.rsaPhone ?? '', rsaEmail: dealer.rsaEmail ?? '', rsaWebsite: dealer.rsaWebsite ?? '' });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="RSA helpline on certificates" subtitle="Leave blank to use the platform helpline">
      {!editable && <Locked />}
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-3">
        <Field label="Toll-free number">
          <Input value={f.rsaPhone} onChange={(e) => setF({ ...f, rsaPhone: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input value={f.rsaEmail} onChange={(e) => setF({ ...f, rsaEmail: e.target.value })} />
        </Field>
        <Field label="Website">
          <Input value={f.rsaWebsite} onChange={(e) => setF({ ...f, rsaWebsite: e.target.value })} />
        </Field>
      </fieldset>
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(f);
              setBusy(false);
            }}
          >
            Save helpline
          </Button>
        </div>
      )}
    </Card>
  );
}

function ConditionsCard({ dealer, editable, onSave }: { dealer: Dealer; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [text, setText] = useState(dealer.dealerConditions ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Dealer-specific special conditions" subtitle="Appended after the standard and plan conditions on new certificates">
      {!editable && <Locked />}
      <Textarea rows={4} value={text} disabled={!editable} onChange={(e) => setText(e.target.value)} placeholder="(c) …" />
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave({ dealerConditions: text });
              setBusy(false);
            }}
          >
            Save conditions
          </Button>
        </div>
      )}
    </Card>
  );
}

function NotificationsCard({ dealer, editable, onSave }: { dealer: Dealer; editable: boolean; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const n = dealer.settings.notifications;
  const [f, setF] = useState({ email: n.email ?? true, sms: n.sms ?? false, whatsapp: n.whatsapp ?? false });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Customer notifications" subtitle='"RSA Policy Successfully Issued" message after issuance'>
      {!editable && <Locked />}
      <div className="space-y-4">
        <Switch disabled={!editable} checked={f.email} onChange={(v) => setF({ ...f, email: v })} label="Email" description="Sent when the customer has an email address" />
        <Switch disabled={!editable} checked={f.sms} onChange={(v) => setF({ ...f, sms: v })} label="SMS" description="Requires an SMS gateway configured on the platform" />
        <Switch disabled={!editable} checked={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} label="WhatsApp" description="Requires a WhatsApp gateway; staff can always share manually" />
      </div>
      {editable && (
        <div className="mt-5 flex justify-end">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave({ notifications: f });
              setBusy(false);
            }}
          >
            Save preferences
          </Button>
        </div>
      )}
    </Card>
  );
}
