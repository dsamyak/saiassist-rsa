import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { FUEL_TYPES, VEHICLE_TYPES } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Product } from '@/lib/types';
import { Alert, Button, Card, Checkbox, ErrorState, Field, Input, PageHeader, PageLoader, Select, Switch, Textarea, toast } from '@/components/ui';

interface FormValues {
  productCode: string;
  planName: string;
  certificatePlanName: string;
  description: string;
  vehicleTypes: string[];
  fuelTypes: string[];
  maxVehicleAgeYears: string;
  numberOfServices: number;
  towingLimitKm: string;
  gstRate: string;
  priceIncludesGst: boolean;
  specialConditions: string;
  eligibilityNotes: string;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
  terms: { id?: string; label: string; validityUnit: 'DAYS' | 'MONTHS'; validityValue: number; price: number; status: 'ACTIVE' | 'INACTIVE' }[];
  benefits: { name: string; description: string; isApplicable: boolean; applicableText: string }[];
  enableForAllDealers: boolean;
}

const EMPTY: FormValues = {
  productCode: '',
  planName: '',
  certificatePlanName: '',
  description: '',
  vehicleTypes: ['TWO_WHEELER'],
  fuelTypes: [],
  maxVehicleAgeYears: '',
  numberOfServices: 1,
  towingLimitKm: '',
  gstRate: '',
  priceIncludesGst: true,
  specialConditions: '',
  eligibilityNotes: '',
  status: 'ACTIVE',
  sortOrder: 0,
  terms: [{ label: '1 Year', validityUnit: 'MONTHS', validityValue: 12, price: 1000, status: 'ACTIVE' }],
  benefits: [{ name: 'Battery Check Up & Jump Start', description: 'A Technician to be arranged for Jumpstart', isApplicable: true, applicableText: '' }],
  enableForAllDealers: true,
};

const toForm = (p: Product): FormValues => ({
  productCode: p.productCode,
  planName: p.planName,
  certificatePlanName: p.certificatePlanName ?? '',
  description: p.description ?? '',
  vehicleTypes: p.vehicleTypes,
  fuelTypes: p.fuelTypes,
  maxVehicleAgeYears: p.maxVehicleAgeYears === null ? '' : String(p.maxVehicleAgeYears),
  numberOfServices: p.numberOfServices,
  towingLimitKm: p.towingLimitKm === null ? '' : String(p.towingLimitKm),
  gstRate: p.gstRate === null ? '' : String(p.gstRate),
  priceIncludesGst: p.priceIncludesGst,
  specialConditions: p.specialConditions ?? '',
  eligibilityNotes: p.eligibilityNotes ?? '',
  status: p.status,
  sortOrder: p.sortOrder,
  terms: p.terms.map((t) => ({ id: t.id, label: t.label, validityUnit: t.validityUnit, validityValue: t.validityValue, price: t.price, status: t.status as 'ACTIVE' | 'INACTIVE' })),
  benefits: p.benefits.map((b) => ({ name: b.name, description: b.description, isApplicable: b.isApplicable, applicableText: b.applicableText ?? '' })),
  enableForAllDealers: false,
});

const num = (v: string) => (v === '' ? null : Number(v));

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  useDocumentTitle(isNew ? 'New RSA product' : 'Edit RSA product');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-product', id], queryFn: () => api<Product>(`/api/admin/rsa/products/${id}`), enabled: !isNew });
  const settings = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<{ defaultGstRate: number }>('/api/admin/settings') });
  const { register, control, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({ defaultValues: EMPTY });
  const terms = useFieldArray({ control, name: 'terms' });
  const benefits = useFieldArray({ control, name: 'benefits' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) reset(toForm(q.data));
  }, [q.data, reset]);

  if (!isNew && q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const values = watch();
  const gst = values.gstRate === '' ? settings.data?.defaultGstRate ?? 18 : Number(values.gstRate);
  const toggleList = (field: 'vehicleTypes' | 'fuelTypes', v: string) => {
    const cur = values[field];
    setValue(field, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v], { shouldDirty: true });
  };

  const submit = handleSubmit(async (v) => {
    setError(null);
    const body = {
      ...v,
      maxVehicleAgeYears: num(v.maxVehicleAgeYears),
      towingLimitKm: num(v.towingLimitKm),
      gstRate: num(v.gstRate),
      numberOfServices: Number(v.numberOfServices),
      sortOrder: Number(v.sortOrder),
      terms: v.terms.map((t) => ({ ...t, validityValue: Number(t.validityValue), price: Number(t.price) })),
      benefits: v.benefits.map((b) => ({ ...b, applicableText: b.applicableText || null })),
    };
    try {
      const saved = isNew
        ? await api<Product>('/api/admin/rsa/products', { method: 'POST', body })
        : await api<Product>(`/api/admin/rsa/products/${id}`, { method: 'PUT', body });
      toast.success('Product saved');
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.setQueryData(['admin-product', saved.id], saved);
      if (isNew) navigate(`/admin/products/${saved.id}`, { replace: true });
      else reset(toForm(saved));
    } catch (e) {
      setError(errorMessage(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  return (
    <form onSubmit={submit} className="space-y-6">
      <PageHeader
        back={{ to: '/admin/products', label: 'RSA products' }}
        title={isNew ? 'New RSA product' : values.planName || 'Edit product'}
        subtitle={isNew ? 'Define the plan, its validity options and the benefits printed on certificates' : `${q.data?.policyCount ?? 0} policies issued · enabled for ${q.data?.dealerCount ?? 0} dealers`}
        actions={
          <Button type="submit" icon={Save} loading={formState.isSubmitting}>
            Save product
          </Button>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {!isNew && <Alert tone="info">Changes apply to new policies only. Issued certificates keep the benefits, conditions and premium they were issued with.</Alert>}

      <Card title="Plan">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product code" required>
            <Input {...register('productCode', { required: true })} className="uppercase" placeholder="TW-BASIC" />
          </Field>
          <Field label="Plan name" required className="lg:col-span-2">
            <Input {...register('planName', { required: true })} placeholder="Two Wheeler RSA - Basic" />
          </Field>
          <Field label="Status">
            <Select {...register('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Field>
          <Field label="Plan name on certificate" hint='Shown in the "RSA Premium Breakup" table' className="lg:col-span-2">
            <Input {...register('certificatePlanName')} placeholder="Defaults to the plan name" />
          </Field>
          <Field label="Display order">
            <Input type="number" {...register('sortOrder')} />
          </Field>
          <Field label="Description" className="sm:col-span-2 lg:col-span-4">
            <Textarea rows={2} {...register('description')} />
          </Field>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Eligibility">
          <p className="mb-2 text-sm font-medium text-slate-700">Vehicle types</p>
          <div className="grid grid-cols-2 gap-2.5">
            {VEHICLE_TYPES.map((t) => (
              <Checkbox key={t.value} label={t.label} checked={values.vehicleTypes.includes(t.value)} onChange={() => toggleList('vehicleTypes', t.value)} />
            ))}
          </div>
          <p className="mb-2 mt-5 text-sm font-medium text-slate-700">Fuel types (none selected = all)</p>
          <div className="grid grid-cols-3 gap-2.5">
            {FUEL_TYPES.map((t) => (
              <Checkbox key={t.value} label={t.label} checked={values.fuelTypes.includes(t.value)} onChange={() => toggleList('fuelTypes', t.value)} />
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Max vehicle age (years)" hint="Blank = no limit">
              <Input type="number" min={0} {...register('maxVehicleAgeYears')} />
            </Field>
            <Field label="Eligibility notes">
              <Input {...register('eligibilityNotes')} />
            </Field>
          </div>
        </Card>
        <Card title="Coverage & GST">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Number of services during the plan" required>
              <Input type="number" min={0} {...register('numberOfServices', { required: true })} />
            </Field>
            <Field label="Towing limit (km)">
              <Input type="number" min={0} {...register('towingLimitKm')} />
            </Field>
            <Field label="GST rate (%)" hint={`Blank = platform default (${settings.data?.defaultGstRate ?? 18}%)`}>
              <Input type="number" step="0.01" min={0} {...register('gstRate')} />
            </Field>
            <div className="flex items-end pb-1">
              <Switch checked={values.priceIncludesGst} onChange={(v) => setValue('priceIncludesGst', v, { shouldDirty: true })} label="Prices include GST" description="Base premium is back-calculated" />
            </div>
          </div>
          <Field label="Plan-specific special conditions" className="mt-4">
            <Textarea rows={3} {...register('specialConditions')} placeholder="Appended after the standard conditions" />
          </Field>
        </Card>
      </div>

      <Card
        title="Validity options & pricing"
        subtitle="Each option can be priced separately; dealers can have their own prices"
        actions={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => terms.append({ label: '2 Years', validityUnit: 'MONTHS', validityValue: 24, price: 0, status: 'ACTIVE' })}>
            Add option
          </Button>
        }
      >
        <div className="space-y-3">
          {terms.fields.map((t, i) => {
            const price = Number(values.terms[i]?.price) || 0;
            const base = values.priceIncludesGst ? Math.round((price * 10000) / (100 + gst)) / 100 : price;
            const total = values.priceIncludesGst ? price : Math.round(price * (100 + gst)) / 100;
            return (
              <div key={t.id} className="grid items-end gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-12">
                <Field label="Label" className="sm:col-span-3">
                  <Input {...register(`terms.${i}.label`, { required: true })} />
                </Field>
                <Field label="Validity" className="sm:col-span-2">
                  <Input type="number" min={1} {...register(`terms.${i}.validityValue`, { required: true })} />
                </Field>
                <Field label="Unit" className="sm:col-span-2">
                  <Select {...register(`terms.${i}.validityUnit`)}>
                    <option value="MONTHS">Months</option>
                    <option value="DAYS">Days</option>
                  </Select>
                </Field>
                <Field label={`Price (₹, ${values.priceIncludesGst ? 'incl.' : 'excl.'} GST)`} className="sm:col-span-2">
                  <Input type="number" min={0} step="0.01" {...register(`terms.${i}.price`, { required: true })} />
                </Field>
                <Field label="Status" className="sm:col-span-2">
                  <Select {...register(`terms.${i}.status`)}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </Select>
                </Field>
                <div className="flex justify-end sm:col-span-1">
                  <Button variant="ghost" size="sm" icon={Trash2} disabled={terms.fields.length === 1} onClick={() => terms.remove(i)} aria-label="Remove option" />
                </div>
                <p className="text-xs text-slate-500 sm:col-span-12">
                  Base {formatMoney(base)} + GST {formatMoney(total - base)} = <span className="font-medium text-slate-700">{formatMoney(total)}</span>
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Roadside assistance benefits"
        subtitle={'Printed in order in the coverage table; "Number of Services" is added automatically as the last row'}
        actions={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => benefits.append({ name: '', description: '', isApplicable: true, applicableText: '' })}>
            Add benefit
          </Button>
        }
      >
        <div className="space-y-3">
          {benefits.fields.map((b, i) => (
            <div key={b.id} className="grid items-start gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-12">
              <span className="pt-8 text-sm font-semibold text-slate-400 sm:col-span-1">{i + 1}</span>
              <Field label="Featured benefit" className="sm:col-span-3">
                <Input {...register(`benefits.${i}.name`, { required: true })} />
              </Field>
              <Field label="Description" className="sm:col-span-5">
                <Textarea rows={2} {...register(`benefits.${i}.description`)} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox label="Applicable" {...register(`benefits.${i}.isApplicable`)} className="pt-7" />
                <Input {...register(`benefits.${i}.applicableText`)} placeholder="Custom text" aria-label="Applicable text" />
              </div>
              <div className="flex gap-0.5 pt-6 sm:col-span-1 sm:flex-col">
                <Button variant="ghost" size="sm" icon={ArrowUp} disabled={i === 0} onClick={() => benefits.move(i, i - 1)} aria-label="Move up" />
                <Button variant="ghost" size="sm" icon={ArrowDown} disabled={i === benefits.fields.length - 1} onClick={() => benefits.move(i, i + 1)} aria-label="Move down" />
                <Button variant="ghost" size="sm" icon={Trash2} disabled={benefits.fields.length === 1} onClick={() => benefits.remove(i)} aria-label="Remove" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Checkbox
          label={isNew ? 'Enable this product for all existing dealers' : 'Also enable for every dealer now'}
          description="You can still enable or disable it per dealer from the dealer page"
          {...register('enableForAllDealers')}
        />
      </Card>
      <div className="flex justify-end">
        <Button type="submit" size="lg" icon={Save} loading={formState.isSubmitting}>
          Save product
        </Button>
      </div>
    </form>
  );
}
