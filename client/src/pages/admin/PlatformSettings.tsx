import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Save } from 'lucide-react';
import { api, apiBlob, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocumentTitle } from '@/lib/hooks';
import { examplePolicyNumber } from '@/components/DealerProfileForm';
import { Alert, Button, Card, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Spinner, Switch, Tabs, Textarea, toast } from '@/components/ui';

const PdfViewer = lazy(() => import('@/components/PdfViewer'));

interface Settings {
  platformName: string;
  rsaBrandName: string;
  rsaPhone: string;
  rsaEmail: string;
  rsaWebsite: string;
  defaultIssuerName: string;
  defaultServicingOffice: string;
  defaultGstRate: number;
  policyPrefix: string;
  policyNumberFormat: string;
  policySequenceStart: number;
  expiringSoonDays: number;
  maxFutureStartDays: number;
  standardConditions: string;
  certificate: {
    title: string;
    showQr: boolean;
    showCompanyName: boolean;
    showDob: boolean;
    showGstin: boolean;
    borderColor: string;
    conditionsHeading: string;
    footerNote: string;
  };
  fieldRequirements: Record<'customerDob' | 'customerEmail' | 'vehicleRegistration' | 'vehicleEngine' | 'vehicleChassis', boolean>;
  notifications: Record<'email' | 'sms' | 'whatsapp', boolean>;
}

type Tab = 'general' | 'numbering' | 'template' | 'rules';

export default function PlatformSettings() {
  useDocumentTitle('Platform settings');
  const { reload } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<Settings>('/api/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>('general');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);
  if (q.isLoading || (!s && !q.error)) return <PageLoader />;
  if (q.error || !s) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setCert = <K extends keyof Settings['certificate']>(k: K, v: Settings['certificate'][K]) => setS({ ...s, certificate: { ...s.certificate, [k]: v } });
  const txt = (k: keyof Settings) => ({ value: String(s[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });
  const numIn = (k: keyof Settings) => ({ type: 'number', value: String(s[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never) });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api<Settings>('/api/admin/settings', { method: 'PUT', body: s });
      setS(saved);
      qc.setQueryData(['platform-settings'], saved);
      toast.success('Settings saved');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const showPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(await apiBlob('/api/admin/settings/preview', { method: 'POST', body: s }));
    } catch (e) {
      toast.error(errorMessage(e));
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform settings"
        subtitle="Central configuration shared by every dealer workspace"
        actions={
          <>
            <Button variant="secondary" icon={Eye} onClick={showPreview}>
              Preview certificate
            </Button>
            <Button icon={Save} loading={busy} onClick={save}>
              Save settings
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'general', label: 'Brand & helpline' },
          { key: 'numbering', label: 'GST, numbering & validity' },
          { key: 'template', label: 'Certificate template' },
          { key: 'rules', label: 'Fields & notifications' },
        ]}
      />

      {tab === 'general' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Platform">
            <div className="space-y-4">
              <Field label="Platform name" hint="Shown on sign-in, emails and the verification page">
                <Input {...txt('platformName')} />
              </Field>
              <Field label="RSA brand name" hint="Default plan name in the certificate's premium table">
                <Input {...txt('rsaBrandName')} />
              </Field>
            </div>
          </Card>
          <Card title="Default RSA helpline" subtitle="Printed on certificates unless a dealer overrides it">
            <div className="space-y-4">
              <Field label="Toll-free number">
                <Input {...txt('rsaPhone')} />
              </Field>
              <Field label="Email">
                <Input {...txt('rsaEmail')} />
              </Field>
              <Field label="Website">
                <Input {...txt('rsaWebsite')} />
              </Field>
            </div>
          </Card>
          <Card title="Default issuer" subtitle="Used when a dealer has no issuer / servicing office configured" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Certificate issuer">
                <Input {...txt('defaultIssuerName')} />
              </Field>
              <Field label="Servicing office address">
                <Textarea rows={2} {...txt('defaultServicingOffice')} />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === 'numbering' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="GST">
            <Field label="Default GST rate (%)" hint="Products can override this">
              <Input {...numIn('defaultGstRate')} step="0.01" min={0} max={40} />
            </Field>
          </Card>
          <Card title="Validity rules">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label='"Expiring soon" window (days)'>
                <Input {...numIn('expiringSoonDays')} min={1} max={180} />
              </Field>
              <Field label="Max days a start date can be in the future">
                <Input {...numIn('maxFutureStartDays')} min={0} max={365} />
              </Field>
            </div>
          </Card>
          <Card title="Certificate numbering (platform sequence)" subtitle="Used by every dealer that has no format of its own" className="lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Prefix">
                <Input {...txt('policyPrefix')} className="uppercase" maxLength={8} />
              </Field>
              <Field label="Format" hint="{PREFIX} {DEALER} {YYYY} {YY} {MM} {DD} {SEQ:n}">
                <Input {...txt('policyNumberFormat')} className="font-mono" />
              </Field>
              <Field label="Sequence starts at" hint="Only used before the first certificate is issued">
                <Input {...numIn('policySequenceStart')} min={1} />
              </Field>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Example: <span className="font-mono font-semibold text-slate-900">{examplePolicyNumber(s.policyNumberFormat, s.policyPrefix, 'DEALER')}</span>
            </p>
          </Card>
        </div>
      )}

      {tab === 'template' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Master certificate template" subtitle="One design for all dealers - branding and data are filled in automatically">
            <div className="space-y-4">
              <Field label="Certificate title" hint="Printed above the certificate number">
                <Input value={s.certificate.title} onChange={(e) => setCert('title', e.target.value)} />
              </Field>
              <Field label="Border colour">
                <div className="flex items-center gap-3">
                  <input type="color" value={s.certificate.borderColor} onChange={(e) => setCert('borderColor', e.target.value)} className="h-10 w-14 cursor-pointer rounded border-0 bg-transparent" />
                  <Input value={s.certificate.borderColor} onChange={(e) => setCert('borderColor', e.target.value)} className="w-32 font-mono" />
                </div>
              </Field>
              <Switch checked={s.certificate.showQr} onChange={(v) => setCert('showQr', v)} label="QR verification code" description="Links to the public verification page" />
              <Switch checked={s.certificate.showCompanyName} onChange={(v) => setCert('showCompanyName', v)} label="Company name under the logo" />
              <Switch checked={s.certificate.showDob} onChange={(v) => setCert('showDob', v)} label="Print customer date of birth" />
              <Switch checked={s.certificate.showGstin} onChange={(v) => setCert('showGstin', v)} label="Print dealer GSTIN in the issuer block" />
            </div>
          </Card>
          <Card title="Conditions & footer">
            <div className="space-y-4">
              <Field label="Conditions heading">
                <Input value={s.certificate.conditionsHeading} onChange={(e) => setCert('conditionsHeading', e.target.value)} />
              </Field>
              <Field label="Standard special conditions" hint="Applies to every plan; plan- and dealer-specific conditions are appended">
                <Textarea rows={7} {...txt('standardConditions')} />
              </Field>
              <Field label="Footer note">
                <Input value={s.certificate.footerNote} onChange={(e) => setCert('footerNote', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {tab === 'rules' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Mandatory fields" subtitle="Platform default; dealers can be overridden individually">
            <div className="space-y-4">
              {(
                [
                  ['customerDob', 'Customer date of birth'],
                  ['customerEmail', 'Customer email'],
                  ['vehicleRegistration', 'Vehicle registration number (disables "New")'],
                  ['vehicleEngine', 'Engine number'],
                  ['vehicleChassis', 'Chassis number'],
                ] as const
              ).map(([k, label]) => (
                <Switch key={k} checked={s.fieldRequirements[k]} onChange={(v) => set('fieldRequirements', { ...s.fieldRequirements, [k]: v })} label={label} />
              ))}
            </div>
          </Card>
          <Card title="Issuance notifications" subtitle="Default channels for the “RSA Policy Successfully Issued” message">
            <div className="space-y-4">
              <Switch checked={s.notifications.email} onChange={(v) => set('notifications', { ...s.notifications, email: v })} label="Email" description="Configure RESEND_API_KEY and EMAIL_FROM on the server" />
              <Switch checked={s.notifications.sms} onChange={(v) => set('notifications', { ...s.notifications, sms: v })} label="SMS" description="Configure SMS_WEBHOOK_URL on the server" />
              <Switch checked={s.notifications.whatsapp} onChange={(v) => set('notifications', { ...s.notifications, whatsapp: v })} label="WhatsApp" description="Configure WHATSAPP_WEBHOOK_URL on the server" />
            </div>
            <Alert tone="info" className="mt-5">
              Without a gateway, attempts are logged as “not configured” and staff can still share certificates with the one-click WhatsApp button.
            </Alert>
          </Card>
        </div>
      )}

      <Modal open={previewing} onClose={() => setPreviewing(false)} title="Certificate preview" description="Sample data with the settings above (not yet saved)" size="xl">
        {preview ? (
          <Suspense fallback={<Spinner />}>
            <PdfViewer blob={preview} />
          </Suspense>
        ) : (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        )}
      </Modal>
    </div>
  );
}
