import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageUp } from 'lucide-react';
import { DEALER_EDITABLE_SECTIONS, INDIAN_STATES } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { imageToPngDataUrl } from '@/lib/files';
import type { Dealer } from '@/lib/types';
import { Alert, Card, Checkbox, Field, Input, Select, Switch, Textarea } from './ui';

export interface PlatformSettingsLite {
  platformName: string;
  rsaPhone: string;
  rsaEmail: string;
  rsaWebsite: string;
  policyPrefix: string;
  policyNumberFormat: string;
  fieldRequirements: Record<string, boolean>;
  notifications: Record<string, boolean>;
}

type Tri = 'inherit' | 'yes' | 'no';
const FIELD_LABELS: Record<string, string> = {
  customerDob: 'Customer date of birth',
  customerEmail: 'Customer email',
  vehicleRegistration: 'Vehicle registration number',
  vehicleEngine: 'Engine number',
  vehicleChassis: 'Chassis number',
};
const NOTIFY_LABELS: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

export interface DealerFormState {
  dealerCode: string;
  dealerName: string;
  legalName: string;
  issuerName: string;
  servicingOffice: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  rsaPhone: string;
  rsaEmail: string;
  rsaWebsite: string;
  policyPrefix: string;
  policyNumberFormat: string;
  dealerConditions: string;
  allowCustomConditions: boolean;
  fieldRequirements: Record<string, Tri>;
  notifications: Record<string, Tri>;
  editableSections: string[];
  logo: string | null;
}

export function initDealerForm(d?: Dealer | null): DealerFormState {
  const tri = (v: boolean | undefined): Tri => (v === undefined ? 'inherit' : v ? 'yes' : 'no');
  return {
    dealerCode: d?.dealerCode ?? '',
    dealerName: d?.dealerName ?? '',
    legalName: d?.legalName ?? '',
    issuerName: d?.issuerName ?? '',
    servicingOffice: d?.servicingOffice ?? '',
    gstin: d?.gstin ?? '',
    address: d?.address ?? '',
    city: d?.city ?? '',
    state: d?.state ?? 'Maharashtra',
    pincode: d?.pincode ?? '',
    phone: d?.phone ?? '',
    email: d?.email ?? '',
    website: d?.website ?? '',
    rsaPhone: d?.rsaPhone ?? '',
    rsaEmail: d?.rsaEmail ?? '',
    rsaWebsite: d?.rsaWebsite ?? '',
    policyPrefix: d?.policyPrefix ?? '',
    policyNumberFormat: d?.policyNumberFormat ?? '',
    dealerConditions: d?.dealerConditions ?? '',
    allowCustomConditions: d?.allowCustomConditions ?? false,
    fieldRequirements: Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, tri(d?.settings.fieldRequirements[k as keyof Dealer['settings']['fieldRequirements']])])),
    notifications: Object.fromEntries(Object.keys(NOTIFY_LABELS).map((k) => [k, tri(d?.settings.notifications[k as keyof Dealer['settings']['notifications']])])),
    editableSections: d?.settings.editableSections ?? ['logo', 'contact', 'notifications'],
    logo: null,
  };
}

export function dealerPayload(f: DealerFormState) {
  const fromTri = (o: Record<string, Tri>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 'inherit').map(([k, v]) => [k, v === 'yes']));
  return {
    dealerName: f.dealerName,
    legalName: f.legalName,
    issuerName: f.issuerName,
    servicingOffice: f.servicingOffice,
    gstin: f.gstin,
    address: f.address,
    city: f.city,
    state: f.state,
    pincode: f.pincode,
    phone: f.phone,
    email: f.email,
    website: f.website,
    rsaPhone: f.rsaPhone,
    rsaEmail: f.rsaEmail,
    rsaWebsite: f.rsaWebsite,
    policyPrefix: f.policyPrefix,
    policyNumberFormat: f.policyNumberFormat,
    dealerConditions: f.dealerConditions,
    allowCustomConditions: f.allowCustomConditions,
    settings: { fieldRequirements: fromTri(f.fieldRequirements), notifications: fromTri(f.notifications), editableSections: f.editableSections },
    logo: f.logo,
  };
}

export function examplePolicyNumber(format: string, prefix: string, code: string) {
  const now = new Date();
  return format
    .replace(/\{(PREFIX|DEALER|YYYY|YY|MM|DD|SEQ)(?::(\d{1,2}))?\}/g, (_m, t: string, w?: string) =>
      t === 'PREFIX'
        ? prefix
        : t === 'DEALER'
          ? code
          : t === 'YYYY'
            ? String(now.getFullYear())
            : t === 'YY'
              ? String(now.getFullYear()).slice(-2)
              : t === 'MM'
                ? String(now.getMonth() + 1).padStart(2, '0')
                : t === 'DD'
                  ? String(now.getDate()).padStart(2, '0')
                  : '1'.padStart(w ? Number(w) : 6, '0'),
    )
    .toUpperCase();
}

export function usePlatformSettings() {
  return useQuery({ queryKey: ['platform-settings'], queryFn: () => api<PlatformSettingsLite>('/api/admin/settings') });
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {children}
    </Card>
  );
}

export function DealerProfileForm({ value, onChange, mode, currentLogoUrl }: { value: DealerFormState; onChange: (v: DealerFormState) => void; mode: 'create' | 'edit'; currentLogoUrl?: string | null }) {
  const settings = usePlatformSettings();
  const [logoError, setLogoError] = useState<string | null>(null);
  const set = <K extends keyof DealerFormState>(k: K, v: DealerFormState[K]) => onChange({ ...value, [k]: v });
  const input = (k: keyof DealerFormState) => ({
    value: value[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never),
  });
  const ps = settings.data;
  const format = value.policyNumberFormat || ps?.policyNumberFormat || '';
  const example = format ? examplePolicyNumber(format, value.policyPrefix || ps?.policyPrefix || '', value.dealerCode || 'CODE') : '';

  return (
    <div className="space-y-6">
      <Section title="Dealer identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dealer code" required hint="Unique short code, e.g. SAI-KOP. Cannot be changed later.">
            <Input {...input('dealerCode')} disabled={mode === 'edit'} className="uppercase" />
          </Field>
          <Field label="Dealer name" required hint="Shown in the dealer workspace">
            <Input {...input('dealerName')} />
          </Field>
          <Field label="Legal / company name" className="sm:col-span-2" hint="Used as the company name on certificates">
            <Input {...input('legalName')} />
          </Field>
        </div>
      </Section>

      <Section title="Certificate branding" subtitle="Printed in the header and issuer block of every certificate">
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Logo</p>
            <div className="grid h-24 w-full place-items-center rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              {value.logo || currentLogoUrl ? <img src={value.logo ?? currentLogoUrl!} alt="Logo preview" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
            </div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
              <ImageUp className="size-3.5" /> {value.logo || currentLogoUrl ? 'Replace logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoError(null);
                  try {
                    set('logo', await imageToPngDataUrl(file));
                  } catch (err) {
                    setLogoError(errorMessage(err));
                  }
                }}
              />
            </label>
            {logoError && <p className="mt-1 text-xs text-red-600">{logoError}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Certificate issuer & servicing office" className="sm:col-span-2" hint='Printed after "Certificate issuer & Servicing Office :"'>
              <Input {...input('issuerName')} placeholder="e.g. SAI MOTORS PRIVATE LIMITED" />
            </Field>
            <Field label="Servicing office address" className="sm:col-span-2" hint="Use line breaks to control how the address wraps">
              <Textarea rows={3} {...input('servicingOffice')} />
            </Field>
            <Field label="GSTIN">
              <Input {...input('gstin')} className="uppercase" maxLength={15} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Dealer contact details">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Address" className="sm:col-span-3">
            <Input {...input('address')} />
          </Field>
          <Field label="City">
            <Input {...input('city')} />
          </Field>
          <Field label="State">
            <Select {...input('state')}>
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Pincode">
            <Input {...input('pincode')} maxLength={6} />
          </Field>
          <Field label="Phone">
            <Input {...input('phone')} />
          </Field>
          <Field label="Email">
            <Input type="email" {...input('email')} />
          </Field>
          <Field label="Website">
            <Input {...input('website')} />
          </Field>
        </div>
      </Section>

      <Section title="RSA helpline on certificates" subtitle="Leave blank to use the platform helpline">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Toll-free number">
            <Input {...input('rsaPhone')} placeholder={ps?.rsaPhone} />
          </Field>
          <Field label="Email">
            <Input {...input('rsaEmail')} placeholder={ps?.rsaEmail} />
          </Field>
          <Field label="Website">
            <Input {...input('rsaWebsite')} placeholder={ps?.rsaWebsite} />
          </Field>
        </div>
      </Section>

      <Section title="Certificate numbering" subtitle="Leave the format blank to use the platform-wide sequence">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Prefix" hint="1-8 letters/digits, unique per dealer">
            <Input {...input('policyPrefix')} className="uppercase" maxLength={8} placeholder={ps?.policyPrefix} />
          </Field>
          <Field label="Format" className="sm:col-span-2" hint="Tokens: {PREFIX} {DEALER} {YYYY} {YY} {MM} {DD} {SEQ:6}. Custom formats must include {PREFIX} or {DEALER}.">
            <Input {...input('policyNumberFormat')} placeholder={ps ? `${ps.policyNumberFormat} (platform default)` : ''} className="font-mono" />
          </Field>
        </div>
        {example && (
          <p className="mt-3 text-sm text-slate-600">
            Example: <span className="font-mono font-semibold text-slate-900">{example}</span>
          </p>
        )}
      </Section>

      <Section title="Special conditions">
        <Switch checked={value.allowCustomConditions} onChange={(v) => set('allowCustomConditions', v)} label="Allow dealer-specific conditions" description="Appended to the standard and plan conditions on this dealer's certificates" />
        {value.allowCustomConditions && (
          <Field label="Dealer conditions" className="mt-4">
            <Textarea rows={3} {...input('dealerConditions')} placeholder="(c) …" />
          </Field>
        )}
      </Section>

      <Section title="Workspace rules" subtitle="Override platform defaults for this dealer">
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Required fields</p>
            <div className="space-y-2.5">
              {Object.entries(FIELD_LABELS).map(([k, label]) => (
                <TriSelect
                  key={k}
                  label={label}
                  value={value.fieldRequirements[k]}
                  inherited={ps?.fieldRequirements[k]}
                  yes="Required"
                  no="Optional"
                  onChange={(v) => set('fieldRequirements', { ...value.fieldRequirements, [k]: v })}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer notifications</p>
            <div className="space-y-2.5">
              {Object.entries(NOTIFY_LABELS).map(([k, label]) => (
                <TriSelect
                  key={k}
                  label={label}
                  value={value.notifications[k]}
                  inherited={ps?.notifications[k]}
                  yes="On"
                  no="Off"
                  onChange={(v) => set('notifications', { ...value.notifications, [k]: v })}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Dealer Admin may edit</p>
            <div className="space-y-2.5">
              {DEALER_EDITABLE_SECTIONS.map((s) => (
                <Checkbox
                  key={s.key}
                  label={s.label}
                  checked={value.editableSections.includes(s.key)}
                  onChange={() =>
                    set('editableSections', value.editableSections.includes(s.key) ? value.editableSections.filter((x) => x !== s.key) : [...value.editableSections, s.key])
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </Section>
      {!ps && settings.error ? <Alert tone="warning">Could not load platform defaults.</Alert> : null}
    </div>
  );
}

function TriSelect({ label, value, inherited, yes, no, onChange }: { label: string; value: Tri; inherited?: boolean; yes: string; no: string; onChange: (v: Tri) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-700">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Tri)} className="h-8 rounded-md border-0 bg-white px-2 text-xs ring-1 ring-inset ring-slate-300">
        <option value="inherit">Default ({inherited ? yes : no})</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </label>
  );
}
