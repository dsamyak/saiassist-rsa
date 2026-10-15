import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { FUEL_TYPES, INDIAN_STATES, VEHICLE_MAKES, VEHICLE_TYPES } from '@shared/constants';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Customer, Vehicle } from '@/lib/types';
import { Alert, Button, Checkbox, Field, Input, Select } from './ui';

/** Maps server validation errors onto form fields; returns a message for the form-level alert. */
export function applyServerErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>): string {
  if (e instanceof ApiError) {
    for (const [k, msg] of Object.entries(e.fields)) setError(k as Path<T>, { type: 'server', message: msg });
    return e.message;
  }
  return errorMessage(e);
}

interface CustomerValues {
  name: string;
  dob: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

export function CustomerForm({
  initial,
  onSaved,
  onCancel,
  submitLabel,
}: {
  initial?: Customer | null;
  onSaved: (c: Customer) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { session } = useAuth();
  const req = session?.dealer?.fieldRequirements;
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({
    defaultValues: {
      name: initial?.name ?? '',
      dob: initial?.dob ?? '',
      mobile: initial?.mobile ?? '',
      email: initial?.email ?? '',
      address: initial?.address ?? '',
      city: initial?.city ?? '',
      state: initial?.state ?? 'Maharashtra',
      pincode: initial?.pincode ?? '',
    },
  });
  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = initial
        ? await api<Customer>(`/api/customers/${initial.id}`, { method: 'PUT', body: values })
        : await api<Customer>('/api/customers', { method: 'POST', body: values });
      onSaved(saved);
    } catch (e) {
      setFormError(applyServerErrors(e, setError));
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name" required error={errors.name?.message} className="sm:col-span-2">
          <Input {...register('name', { required: 'Customer name is required' })} invalid={!!errors.name} placeholder="As per ID proof" autoComplete="off" />
        </Field>
        <Field label="Mobile number" required error={errors.mobile?.message}>
          <Input {...register('mobile', { required: 'Mobile number is required' })} invalid={!!errors.mobile} inputMode="tel" placeholder="10-digit mobile" />
        </Field>
        <Field label="Email" required={req?.customerEmail} error={errors.email?.message}>
          <Input type="email" {...register('email', { required: req?.customerEmail ? 'Email is required' : false })} invalid={!!errors.email} placeholder="name@example.com" />
        </Field>
        <Field label="Date of birth" required={req?.customerDob} error={errors.dob?.message}>
          <Input type="date" {...register('dob', { required: req?.customerDob ? 'Date of birth is required' : false })} invalid={!!errors.dob} />
        </Field>
        <Field label="Pincode" required error={errors.pincode?.message}>
          <Input {...register('pincode', { required: 'Pincode is required', pattern: { value: /^\d{6}$/, message: 'Pincode must be 6 digits' } })} invalid={!!errors.pincode} inputMode="numeric" maxLength={6} />
        </Field>
        <Field label="Address" required error={errors.address?.message} className="sm:col-span-2">
          <Input {...register('address', { required: 'Address is required' })} invalid={!!errors.address} placeholder="House / street / area" />
        </Field>
        <Field label="City" required error={errors.city?.message}>
          <Input {...register('city', { required: 'City is required' })} invalid={!!errors.city} />
        </Field>
        <Field label="State" required error={errors.state?.message}>
          <Select {...register('state', { required: 'State is required' })}>
            {INDIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel ?? (initial ? 'Save changes' : 'Create customer')}
        </Button>
      </div>
    </form>
  );
}

interface VehicleValues {
  registrationNo: string;
  isNew: boolean;
  vehicleType: string;
  make: string;
  model: string;
  variant: string;
  engineNo: string;
  chassisNo: string;
  fuelType: string;
  manufacturingYear: number;
}

export function VehicleForm({
  customerId,
  initial,
  onSaved,
  onCancel,
  submitLabel,
}: {
  customerId: string;
  initial?: Vehicle | null;
  onSaved: (v: Vehicle) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { session } = useAuth();
  const req = session?.dealer?.fieldRequirements;
  const [formError, setFormError] = useState<string | null>(null);
  const year = new Date().getFullYear();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VehicleValues>({
    defaultValues: {
      registrationNo: initial?.registrationNo ?? '',
      isNew: initial ? !initial.registrationNo : false,
      vehicleType: initial?.vehicleType ?? 'TWO_WHEELER',
      make: initial?.make ?? '',
      model: initial?.model ?? '',
      variant: initial?.variant ?? '',
      engineNo: initial?.engineNo ?? '',
      chassisNo: initial?.chassisNo ?? '',
      fuelType: initial?.fuelType ?? 'PETROL',
      manufacturingYear: initial?.manufacturingYear ?? year,
    },
  });
  const isNew = watch('isNew');
  const submit = handleSubmit(async ({ isNew: newVehicle, ...values }) => {
    setFormError(null);
    const body = { ...values, customerId, registrationNo: newVehicle ? null : values.registrationNo, manufacturingYear: Number(values.manufacturingYear) };
    try {
      const saved = initial
        ? await api<Vehicle>(`/api/vehicles/${initial.id}`, { method: 'PUT', body })
        : await api<Vehicle>('/api/vehicles', { method: 'POST', body });
      onSaved(saved);
    } catch (e) {
      setFormError(applyServerErrors(e, setError));
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Registration number" required={req?.vehicleRegistration && !isNew} error={errors.registrationNo?.message}>
            <Input
              {...register('registrationNo', { required: req?.vehicleRegistration && !isNew ? 'Registration number is required' : false })}
              disabled={isNew}
              invalid={!!errors.registrationNo}
              placeholder={isNew ? 'New - registration pending' : 'e.g. MH09AB1234'}
              className="uppercase"
            />
          </Field>
          {!req?.vehicleRegistration && (
            <Checkbox {...register('isNew')} label="New vehicle - registration pending" description='Printed as "New" on the certificate. You can endorse the number later.' className="mt-2" />
          )}
        </div>
        <Field label="Vehicle type" required>
          <Select {...register('vehicleType')}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fuel type" required>
          <Select {...register('fuelType')}>
            {FUEL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Make" required error={errors.make?.message}>
          <Input {...register('make', { required: 'Make is required' })} list="vehicle-makes" invalid={!!errors.make} placeholder="e.g. Honda" />
          <datalist id="vehicle-makes">
            {VEHICLE_MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Model" required error={errors.model?.message}>
          <Input {...register('model', { required: 'Model is required' })} invalid={!!errors.model} placeholder="e.g. SP125" />
        </Field>
        <Field label="Variant" required error={errors.variant?.message} className="sm:col-span-2">
          <Input {...register('variant', { required: 'Variant is required' })} invalid={!!errors.variant} placeholder="e.g. DLX Drum Brake Alloy Wheel" />
        </Field>
        <Field label="Engine number" required={req?.vehicleEngine} error={errors.engineNo?.message}>
          <Input {...register('engineNo', { required: req?.vehicleEngine ? 'Engine number is required' : false })} invalid={!!errors.engineNo} className="uppercase" />
        </Field>
        <Field label="Chassis number" required={req?.vehicleChassis} error={errors.chassisNo?.message}>
          <Input {...register('chassisNo', { required: req?.vehicleChassis ? 'Chassis number is required' : false })} invalid={!!errors.chassisNo} className="uppercase" />
        </Field>
        <Field label="Manufacturing year" required error={errors.manufacturingYear?.message}>
          <Input
            type="number"
            {...register('manufacturingYear', { required: 'Manufacturing year is required', min: { value: 1980, message: 'Year looks incorrect' }, max: { value: year + 1, message: 'Year cannot be in the future' } })}
            invalid={!!errors.manufacturingYear}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel ?? (initial ? 'Save changes' : 'Add vehicle')}
        </Button>
      </div>
    </form>
  );
}
