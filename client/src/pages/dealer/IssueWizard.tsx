import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bike,
  Car,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSignature,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Truck,
  UserRound,
} from 'lucide-react';
import { PAYMENT_METHODS } from '@shared/constants';
import { api, apiBlob, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openPdf, downloadFile } from '@/lib/files';
import { formatDate, formatDateTime, formatMoney, fuelTypeLabel, todayIst, validityLabel, vehicleTypeLabel } from '@/lib/format';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import type { Customer, Paged, PolicyDetail, Product, Quote, Vehicle } from '@/lib/types';
import { CustomerForm, VehicleForm } from '@/components/forms';
import { PolicyStatusBadge } from '@/components/StatusBadge';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, PageLoader, SearchInput, Select, Spinner, Textarea, cn, toast } from '@/components/ui';

const PdfViewer = lazy(() => import('@/components/PdfViewer'));

const STEPS = ['Customer', 'Vehicle', 'Plan & validity', 'Payment', 'Preview & issue'] as const;
type Step = 0 | 1 | 2 | 3 | 4;

interface PaymentState {
  method: string;
  status: 'SUCCESS' | 'PENDING';
  transactionId: string;
  notes: string;
}

const REF_REQUIRED = ['UPI', 'CARD', 'NET_BANKING', 'CHEQUE'];

const vehicleIcon = (t: string) => (t === 'TWO_WHEELER' ? Bike : t === 'FOUR_WHEELER' ? Car : Truck);

export default function IssueWizard() {
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  const draftId = params.get('draft');
  const preCustomer = params.get('customer');
  const preVehicle = params.get('vehicle');
  useDocumentTitle(renewId ? 'Renew RSA policy' : 'Issue RSA policy');
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [payment, setPayment] = useState<PaymentState>({ method: 'UPI', status: 'SUCCESS', transactionId: '', notes: '' });
  const [issued, setIssued] = useState<PolicyDetail | null>(null);
  const [booting, setBooting] = useState(!!(renewId || draftId || preCustomer || preVehicle));
  const [bootError, setBootError] = useState<string | null>(null);
  const [renewal, setRenewal] = useState<PolicyDetail | null>(null);

  // Pre-fill from a renewal, a saved quotation, or a chosen customer / vehicle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (renewId || draftId) {
          const p = await api<PolicyDetail>(`/api/policies/${renewId ?? draftId}`);
          const c = await api<Customer>(`/api/customers/${p.customerId}`);
          if (cancelled) return;
          setCustomer(c);
          setVehicle(c.vehicles?.find((v) => v.id === p.vehicleId) ?? null);
          setProductId(p.productId);
          setTermId(p.termId);
          if (renewId) {
            setRenewal(p);
            setStep(2);
          } else {
            if (p.renewedFromPolicyId) setRenewal(await api<PolicyDetail>(`/api/policies/${p.renewedFromPolicyId}`));
            const start = p.startDate ? new Date(p.startDate) : null;
            if (start && start.getTime() > Date.now()) setStartDate(new Date(start.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10));
            setStep(3);
          }
        } else if (preVehicle) {
          const v = await api<Vehicle>(`/api/vehicles/${preVehicle}`);
          const c = await api<Customer>(`/api/customers/${v.customerId}`);
          if (cancelled) return;
          setCustomer(c);
          setVehicle(v);
          setStep(2);
        } else if (preCustomer) {
          const c = await api<Customer>(`/api/customers/${preCustomer}`);
          if (cancelled) return;
          setCustomer(c);
          setStep(1);
        }
      } catch (e) {
        if (!cancelled) setBootError(errorMessage(e));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renewId, draftId, preCustomer, preVehicle]);

  const draftBody = customer && vehicle && productId && termId
    ? { customerId: customer.id, vehicleId: vehicle.id, productId, termId, startDate: startDate || null, renewalOfPolicyId: renewal?.id ?? null }
    : null;

  const quote = useQuery({
    queryKey: ['quote', draftBody],
    queryFn: () => api<Quote>('/api/policies/quote', { method: 'POST', body: draftBody }),
    enabled: !!draftBody && step >= 2,
    retry: false,
  });

  const preview = useQuery({
    queryKey: ['preview', draftBody],
    queryFn: () => apiBlob('/api/policies/preview', { method: 'POST', body: draftBody }),
    enabled: !!draftBody && step === 4,
    retry: false,
    staleTime: 60_000,
  });

  const issue = useMutation({
    mutationFn: () =>
      api<PolicyDetail>('/api/policies/issue', {
        method: 'POST',
        body: {
          ...draftBody,
          draftId: draftId ?? null,
          payment: { method: payment.method, status: payment.status, transactionId: payment.transactionId || null, notes: payment.notes || null },
        },
      }),
    onSuccess: (p) => {
      setIssued(p);
      qc.invalidateQueries();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveDraft = useMutation({
    mutationFn: () => api<PolicyDetail>('/api/policies/drafts', { method: 'POST', body: { ...draftBody, draftId: draftId ?? null } }),
    onSuccess: (p) => {
      toast.success('Quotation saved');
      qc.invalidateQueries({ queryKey: ['policies'] });
      navigate(`/app/policies/${p.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (booting) return <PageLoader label="Preparing…" />;
  if (issued) return <Done policy={issued} />;

  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const paymentOk = payment.status === 'PENDING' || !REF_REQUIRED.includes(payment.method) || payment.transactionId.trim().length > 0;
  const canQuoteOnly = can('policies.quote');
  const canIssue = renewal ? can('policies.renew') : can('policies.issue');

  return (
    <div>
      <PageHeader
        title={renewal ? 'Renew RSA policy' : draftId ? 'Issue quotation' : 'Issue RSA policy'}
        subtitle={renewal ? `Renewing certificate ${renewal.policyNumber} (valid till ${formatDate(renewal.endDate)})` : 'Create a Tax Invoice cum Certificate in five quick steps'}
      />
      {bootError && (
        <Alert tone="error" className="mb-6">
          {bootError}
        </Alert>
      )}
      <Stepper step={step} onJump={(s) => s < step && go(s)} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {step === 0 && (
            <StepCustomer
              customer={customer}
              locked={!!renewal}
              onSelect={(c) => {
                if (c?.id !== customer?.id) setVehicle(null);
                setCustomer(c);
              }}
              onNext={() => go(1)}
            />
          )}
          {step === 1 && customer && (
            <StepVehicle
              customer={customer}
              vehicle={vehicle}
              locked={!!renewal}
              onSelect={(v) => {
                setVehicle(v);
              }}
              onBack={() => go(0)}
              onNext={() => go(2)}
            />
          )}
          {step === 2 && vehicle && (
            <StepPlan
              vehicle={vehicle}
              productId={productId}
              termId={termId}
              startDate={startDate}
              renewal={renewal}
              quote={quote.data}
              quoteError={quote.error}
              quoteLoading={quote.isFetching}
              onProduct={(p, t) => {
                setProductId(p);
                setTermId(t);
              }}
              onStartDate={setStartDate}
              onBack={() => go(1)}
              onNext={() => go(3)}
            />
          )}
          {step === 3 && (
            <StepPayment
              payment={payment}
              total={quote.data?.totalPremium}
              onChange={setPayment}
              onBack={() => go(2)}
              onNext={() => go(4)}
              valid={paymentOk}
            />
          )}
          {step === 4 && (
            <Card title="Certificate preview" subtitle="This is exactly how the certificate will look. The number is allocated when you confirm." padded>
              {preview.error ? (
                <Alert tone="error">{errorMessage(preview.error)}</Alert>
              ) : (
                <Suspense fallback={<Spinner />}>
                  <PdfViewer blob={preview.data ?? null} />
                </Suspense>
              )}
              {preview.isLoading && (
                <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
                  <Spinner /> Generating preview…
                </div>
              )}
              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="secondary" icon={Pencil} onClick={() => go(2)}>
                  Edit details
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  {canQuoteOnly && (
                    <Button variant="secondary" icon={Save} loading={saveDraft.isPending} onClick={() => saveDraft.mutate()} disabled={!draftBody}>
                      Save as quotation
                    </Button>
                  )}
                  {canIssue && (
                    <Button icon={FileSignature} size="lg" loading={issue.isPending} disabled={!draftBody || !!quote.error} onClick={() => issue.mutate()}>
                      Confirm &amp; issue certificate
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
        <Summary customer={customer} vehicle={vehicle} quote={step >= 2 ? quote.data : undefined} payment={step >= 3 ? payment : undefined} renewal={renewal} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stepper & summary

function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 scroll-thin">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!done}
              onClick={() => onJump(i as Step)}
              className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm', done && 'hover:bg-slate-50', current ? 'font-semibold text-slate-900' : done ? 'text-slate-700' : 'text-slate-400')}
            >
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full text-xs font-semibold',
                  done ? 'bg-emerald-600 text-white' : current ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cn(!current && 'hidden md:inline')}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200 lg:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

function Summary({ customer, vehicle, quote, payment, renewal }: { customer: Customer | null; vehicle: Vehicle | null; quote?: Quote; payment?: PaymentState; renewal: PolicyDetail | null }) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <Card title="Summary" padded={false}>
        <dl className="divide-y divide-slate-100 text-sm">
          {renewal && (
            <div className="px-5 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Renewal of</dt>
              <dd className="mt-1 font-mono text-slate-900">{renewal.policyNumber}</dd>
            </div>
          )}
          <div className="px-5 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer</dt>
            <dd className="mt-1 text-slate-900">{customer ? customer.name : <span className="text-slate-400">Not selected</span>}</dd>
            {customer && <dd className="text-xs text-slate-500">{customer.mobile}</dd>}
          </div>
          <div className="px-5 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Vehicle</dt>
            <dd className="mt-1 text-slate-900">{vehicle ? `${vehicle.make} ${vehicle.model}` : <span className="text-slate-400">Not selected</span>}</dd>
            {vehicle && <dd className="font-mono text-xs text-slate-500">{vehicle.registrationNo ?? 'New'}</dd>}
          </div>
          <div className="px-5 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Plan</dt>
            <dd className="mt-1 text-slate-900">{quote ? quote.planName : <span className="text-slate-400">Not selected</span>}</dd>
            {quote && (
              <dd className="text-xs text-slate-500">
                {quote.termLabel} · {formatDate(quote.startDate)} – {formatDate(quote.endDate)}
              </dd>
            )}
          </div>
          {quote && (
            <div className="space-y-1.5 bg-slate-50/70 px-5 py-4">
              <div className="flex justify-between text-slate-600">
                <span>Base premium</span>
                <span className="tabular">{formatMoney(quote.basePremium)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>GST @ {quote.gstRate}%</span>
                <span className="tabular">{formatMoney(quote.gstAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
                <span>Total premium</span>
                <span className="tabular">{formatMoney(quote.totalPremium)}</span>
              </div>
            </div>
          )}
          {payment && (
            <div className="px-5 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment</dt>
              <dd className="mt-1 text-slate-900">
                {PAYMENT_METHODS.find((m) => m.value === payment.method)?.label} · {payment.status === 'SUCCESS' ? 'Received' : 'Pending'}
              </dd>
            </div>
          )}
        </dl>
      </Card>
    </aside>
  );
}

function StepFooter({ onBack, onNext, nextDisabled, nextLabel = 'Continue' }: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
      {onBack ? (
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ step 1: customer

function StepCustomer({ customer, locked, onSelect, onNext }: { customer: Customer | null; locked: boolean; onSelect: (c: Customer | null) => void; onNext: () => void }) {
  const { can } = useAuth();
  const [mode, setMode] = useState<'search' | 'new' | 'edit'>(customer ? 'search' : 'search');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const results = useQuery({
    queryKey: ['customers', 'picker', debounced],
    queryFn: () => api<Paged<Customer>>('/api/customers', { query: { search: debounced, pageSize: 8 } }),
    enabled: !customer && mode === 'search',
  });

  if (mode === 'new' || mode === 'edit') {
    return (
      <Card title={mode === 'new' ? 'New customer' : 'Edit customer details'} subtitle="Details are printed on the certificate as entered">
        <CustomerForm
          initial={mode === 'edit' ? customer : null}
          submitLabel={mode === 'new' ? 'Save & continue' : 'Save changes'}
          onCancel={() => setMode('search')}
          onSaved={(c) => {
            onSelect(c);
            setMode('search');
            if (mode === 'new') onNext();
          }}
        />
      </Card>
    );
  }

  if (customer) {
    return (
      <Card title="Certificate holder">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
              <UserRound className="size-5" />
            </span>
            <div className="text-sm">
              <p className="text-base font-semibold text-slate-900">{customer.name}</p>
              <p className="text-slate-600">
                {customer.mobile}
                {customer.email ? ` · ${customer.email}` : ''}
              </p>
              <p className="mt-1 text-slate-500">
                {customer.address}, {customer.city}, {customer.state} - {customer.pincode}
              </p>
              {customer.dob && <p className="mt-1 text-xs text-slate-500">DOB {formatDate(customer.dob)}</p>}
            </div>
          </div>
          <div className="flex gap-2">
            {can('customers.update') && (
              <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setMode('edit')}>
                Edit
              </Button>
            )}
            {!locked && (
              <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
                Change
              </Button>
            )}
          </div>
        </div>
        <StepFooter onNext={onNext} />
      </Card>
    );
  }

  return (
    <Card
      title="Find the customer"
      subtitle="Search by name, mobile number or vehicle registration"
      actions={
        can('customers.create') && (
          <Button size="sm" icon={Plus} onClick={() => setMode('new')}>
            New customer
          </Button>
        )
      }
      padded={false}
    >
      <div className="p-5 pb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Name, mobile or registration no." />
      </div>
      {results.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : results.data?.items.length ? (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {results.data.items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onSelect(c)} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {c.mobile} · {c.city} · {c.vehicleCount ?? 0} vehicle(s)
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={UserRound}
          title={debounced ? 'No matching customer' : 'No customers yet'}
          description={can('customers.create') ? 'Create a new customer to continue.' : undefined}
          action={
            can('customers.create') && (
              <Button icon={Plus} onClick={() => setMode('new')}>
                New customer
              </Button>
            )
          }
        />
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ step 2: vehicle

function StepVehicle({ customer, vehicle, locked, onSelect, onBack, onNext }: { customer: Customer; vehicle: Vehicle | null; locked: boolean; onSelect: (v: Vehicle) => void; onBack: () => void; onNext: () => void }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const q = useQuery({ queryKey: ['customer', customer.id], queryFn: () => api<Customer>(`/api/customers/${customer.id}`) });
  const vehicles = q.data?.vehicles ?? [];
  useEffect(() => {
    if (!q.isLoading && vehicles.length === 0 && can('vehicles.create')) setAdding(true);
  }, [q.isLoading, vehicles.length, can]);

  if (adding || editing) {
    return (
      <Card title={editing ? 'Edit vehicle' : 'Add vehicle'} subtitle={`For ${customer.name}`}>
        <VehicleForm
          customerId={customer.id}
          initial={editing}
          submitLabel={editing ? 'Save changes' : 'Save & continue'}
          onCancel={vehicles.length ? () => (setAdding(false), setEditing(null)) : undefined}
          onSaved={(v) => {
            q.refetch();
            onSelect(v);
            const wasAdding = adding;
            setAdding(false);
            setEditing(null);
            if (wasAdding && !v.activePolicy) onNext();
          }}
        />
      </Card>
    );
  }
  const selected = vehicles.find((v) => v.id === vehicle?.id) ?? vehicle;
  const blocked = !locked && selected?.activePolicy;
  return (
    <Card
      title="Select the vehicle"
      subtitle={`Vehicles registered for ${customer.name}`}
      actions={
        !locked &&
        can('vehicles.create') && (
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
            Add vehicle
          </Button>
        )
      }
    >
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {vehicles
            .filter((v) => !locked || v.id === vehicle?.id)
            .map((v) => {
              const Icon = vehicleIcon(v.vehicleType);
              const active = v.id === selected?.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(v)}
                  className={cn(
                    'relative rounded-xl p-4 text-left ring-1 transition',
                    active ? 'bg-brand-50/60 ring-2 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-slate-300',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold text-slate-900">
                        {v.make} {v.model}
                      </p>
                      <p className="truncate text-xs text-slate-500">{v.variant}</p>
                      <p className="mt-1.5 font-mono text-xs text-slate-700">{v.registrationNo ?? 'New (registration pending)'}</p>
                      <p className="font-mono text-[11px] text-slate-500">Chassis {v.chassisNo ?? '—'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {vehicleTypeLabel(v.vehicleType)} · {fuelTypeLabel(v.fuelType)} · {v.manufacturingYear}
                      </p>
                    </div>
                  </div>
                  {v.activePolicy && (
                    <span className="mt-3 inline-flex">
                      <Badge tone="amber" icon={ShieldCheck}>
                        Covered till {formatDate(v.activePolicy.endDate)}
                      </Badge>
                    </span>
                  )}
                  {active && <CheckCircle2 className="absolute right-3 top-3 size-5 text-brand-700" />}
                </button>
              );
            })}
        </div>
      )}
      {selected && can('vehicles.update') && !locked && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(selected)}>
            Edit selected vehicle
          </Button>
        </div>
      )}
      {blocked && selected?.activePolicy && (
        <Alert tone="warning" className="mt-4" title="This vehicle already has RSA cover">
          Certificate {selected.activePolicy.policyNumber} is valid till {formatDate(selected.activePolicy.endDate)}.{' '}
          {can('policies.renew') && selected.activePolicy.status === 'ACTIVE' && (
            <Link to={`/app/issue?renew=${selected.activePolicy.id}`} className="font-semibold underline" reloadDocument>
              Renew it instead
            </Link>
          )}
        </Alert>
      )}
      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={!selected || !!blocked} />
    </Card>
  );
}

// ------------------------------------------------------------------ step 3: plan

function StepPlan({
  vehicle,
  productId,
  termId,
  startDate,
  renewal,
  quote,
  quoteError,
  quoteLoading,
  onProduct,
  onStartDate,
  onBack,
  onNext,
}: {
  vehicle: Vehicle;
  productId: string | null;
  termId: string | null;
  startDate: string;
  renewal: PolicyDetail | null;
  quote?: Quote;
  quoteError: unknown;
  quoteLoading: boolean;
  onProduct: (p: string, t: string) => void;
  onStartDate: (d: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const q = useQuery({ queryKey: ['dealer-products', vehicle.id], queryFn: () => api<Product[]>('/api/rsa/products', { query: { vehicleId: vehicle.id } }) });
  const products = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => Number(!!b.eligibility?.eligible) - Number(!!a.eligibility?.eligible)),
    [q.data],
  );
  useEffect(() => {
    if (!productId && products.length) {
      const first = products.find((p) => p.eligibility?.eligible);
      if (first) onProduct(first.id, first.terms[0].id);
    }
  }, [products, productId, onProduct]);
  const minStart = quote && renewal ? quote.startDateInput : todayIst();

  return (
    <Card title="Choose the RSA plan" subtitle={`Plans available for ${vehicle.make} ${vehicle.model} (${vehicleTypeLabel(vehicle.vehicleType)}, ${fuelTypeLabel(vehicle.fuelType)})`}>
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : products.length === 0 ? (
        <EmptyState title="No RSA plans enabled" description="Ask the platform administrator to enable RSA products for your dealership." />
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
            const eligible = p.eligibility?.eligible !== false;
            const selected = p.id === productId;
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-xl p-4 ring-1 transition',
                  !eligible ? 'bg-slate-50 opacity-70 ring-slate-200' : selected ? 'bg-brand-50/50 ring-2 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-slate-300',
                )}
              >
                <button type="button" disabled={!eligible} onClick={() => onProduct(p.id, p.terms[0].id)} className="w-full text-left disabled:cursor-not-allowed">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        {p.planName} <span className="font-mono text-xs font-normal text-slate-500">{p.productCode}</span>
                      </p>
                      {p.description && <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold text-slate-900 tabular">{formatMoney(p.terms[0].premium?.totalPremium)}</p>
                      <p className="text-xs text-slate-500">from · incl. GST</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="blue">{p.numberOfServices} service{p.numberOfServices === 1 ? '' : 's'}</Badge>
                    {p.towingLimitKm ? <Badge tone="gray">Towing up to {p.towingLimitKm} km</Badge> : null}
                    {p.benefits.slice(0, 3).map((b) => (
                      <Badge key={b.name} tone="gray">
                        {b.name.replace(/\*$/, '')}
                      </Badge>
                    ))}
                    {p.benefits.length > 3 && <Badge tone="gray">+{p.benefits.length - 3} more</Badge>}
                  </div>
                  {!eligible && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <AlertTriangle className="size-3.5" /> {p.eligibility?.reasons.join('; ')}
                    </p>
                  )}
                </button>
                {selected && eligible && p.terms.length > 0 && (
                  <div className="mt-4 border-t border-brand-100 pt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Validity</p>
                    <div className="flex flex-wrap gap-2">
                      {p.terms.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onProduct(p.id, t.id)}
                          className={cn(
                            'rounded-lg px-3.5 py-2 text-left text-sm ring-1 transition',
                            t.id === termId ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400',
                          )}
                        >
                          <span className="block font-medium">{t.label}</span>
                          <span className={cn('block text-xs tabular', t.id === termId ? 'text-brand-100' : 'text-slate-500')}>
                            {formatMoney(t.premium?.totalPremium)} · {validityLabel(t.validityUnit, t.validityValue)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Certificate start date" hint={renewal ? 'Renewal cover starts after the current certificate ends' : 'Cover starts at 00:00 on this date'}>
          <Input type="date" value={startDate || quote?.startDateInput || ''} min={minStart} onChange={(e) => onStartDate(e.target.value)} />
        </Field>
        <div className="rounded-lg bg-slate-50 p-3.5 text-sm ring-1 ring-inset ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage period</p>
          {quoteLoading && !quote ? (
            <Spinner className="mt-2 size-4" />
          ) : quote ? (
            <p className="mt-1 font-medium text-slate-900 tabular">
              {formatDateTime(quote.startDate)} → {formatDateTime(quote.endDate)}
            </p>
          ) : (
            <p className="mt-1 text-slate-400">Select a plan</p>
          )}
        </div>
      </div>
      {quoteError ? (
        <Alert tone="error" className="mt-4">
          {errorMessage(quoteError)}
        </Alert>
      ) : null}
      {quote?.warning && (
        <Alert tone="warning" className="mt-4">
          {quote.warning}
        </Alert>
      )}
      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={!quote || !!quoteError || !!quote.warning || quoteLoading} />
    </Card>
  );
}

// ------------------------------------------------------------------ step 4: payment

function StepPayment({ payment, total, onChange, onBack, onNext, valid }: { payment: PaymentState; total?: number; onChange: (p: PaymentState) => void; onBack: () => void; onNext: () => void; valid: boolean }) {
  const needsRef = payment.status === 'SUCCESS' && REF_REQUIRED.includes(payment.method);
  return (
    <Card title="Payment details" subtitle={total !== undefined ? `Amount payable: ${formatMoney(total)} (inclusive of GST)` : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['SUCCESS', 'PENDING'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ ...payment, status: s })}
            className={cn('rounded-xl p-4 text-left ring-1 transition', payment.status === s ? 'bg-brand-50/60 ring-2 ring-brand-600' : 'bg-white ring-slate-200 hover:ring-slate-300')}
          >
            <p className="text-sm font-semibold text-slate-900">{s === 'SUCCESS' ? 'Payment received' : 'Payment pending'}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {s === 'SUCCESS' ? 'Certificate becomes active immediately.' : 'Certificate number is reserved; it activates once payment is recorded.'}
            </p>
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Payment method" required>
          <Select value={payment.method} onChange={(e) => onChange({ ...payment, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Transaction / reference no." required={needsRef} error={needsRef && !payment.transactionId.trim() ? 'Required for this payment method' : null}>
          <Input value={payment.transactionId} onChange={(e) => onChange({ ...payment, transactionId: e.target.value })} placeholder={payment.method === 'CHEQUE' ? 'Cheque number' : 'UTR / transaction ID'} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={payment.notes} onChange={(e) => onChange({ ...payment, notes: e.target.value })} placeholder="Optional internal note" />
        </Field>
      </div>
      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={!valid} nextLabel="Preview certificate" />
    </Card>
  );
}

// ------------------------------------------------------------------ done

function Done({ policy }: { policy: PolicyDetail }) {
  const active = policy.status === 'ACTIVE' || policy.status === 'EXPIRING_SOON';
  const s = policy.snapshot;
  const message = [
    'RSA Policy Successfully Issued',
    `Policy No: ${policy.policyNumber}`,
    `Vehicle: ${s.vehicle.make} ${s.vehicle.model} (${s.vehicle.registrationNo ?? 'New'})`,
    `Valid From: ${formatDateTime(policy.startDate)}`,
    `Valid Till: ${formatDateTime(policy.endDate)}`,
    `RSA Helpline: ${s.dealer.rsaPhone}`,
    s.verifyUrl ? `Verify: ${s.verifyUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const wa = `https://wa.me/91${s.customer.mobile}?text=${encodeURIComponent(message)}`;
  const pdfPath = `/api/policies/${policy.id}/pdf`;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="animate-fade-in rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <span className={cn('mx-auto grid size-16 place-items-center rounded-full', active ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600')}>
          <CheckCircle2 className="size-9" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-slate-900">{active ? 'RSA policy issued successfully' : 'Policy created - payment pending'}</h1>
        <p className="mt-2 text-sm text-slate-500">Tax Invoice cum Certificate Number</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-wide text-brand-800">{policy.policyNumber}</p>
        <div className="mt-3 flex justify-center">
          <PolicyStatusBadge status={policy.status} />
        </div>
        <dl className="mx-auto mt-6 grid max-w-md gap-3 rounded-xl bg-slate-50 p-4 text-left text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Customer</dt>
            <dd className="font-medium text-slate-900">{policy.customerName}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Vehicle</dt>
            <dd className="font-medium text-slate-900">
              {policy.makeModel} · {policy.registrationNo ?? 'New'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Valid from</dt>
            <dd className="font-medium text-slate-900 tabular">{formatDateTime(policy.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Valid till</dt>
            <dd className="font-medium text-slate-900 tabular">{formatDateTime(policy.endDate)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">Total premium</dt>
            <dd className="text-lg font-semibold text-slate-900 tabular">{formatMoney(policy.totalPremium)}</dd>
          </div>
        </dl>
        {!active && (
          <Alert tone="warning" className="mt-5 text-left">
            The certificate activates once the payment is recorded from the policy page.
          </Alert>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button icon={Download} onClick={() => downloadFile(`${pdfPath}?download=1`, `${policy.policyNumber}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
            Download certificate
          </Button>
          <Button variant="secondary" icon={Printer} onClick={() => openPdf(pdfPath, `${policy.policyNumber}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
            Open / print
          </Button>
          {active && (
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
              <MessageCircle className="size-4" /> Share on WhatsApp
            </a>
          )}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-4 border-t border-slate-100 pt-5 text-sm">
          <Link to={`/app/policies/${policy.id}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            View policy <ExternalLink className="size-3.5" />
          </Link>
          <Link to="/app/issue" reloadDocument className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            Issue another <RefreshCw className="size-3.5" />
          </Link>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">
        <LinkButton to="/app" variant="ghost" size="sm">
          Back to dashboard
        </LinkButton>
      </p>
    </div>
  );
}
