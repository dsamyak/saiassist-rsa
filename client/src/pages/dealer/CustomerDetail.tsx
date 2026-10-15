import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Car, FilePlus2, Pencil, Plus, RefreshCw, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, fuelTypeLabel, inRenewalWindow, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Customer, Paged, PolicyListItem, Vehicle } from '@/lib/types';
import { CustomerForm, VehicleForm } from '@/components/forms';
import { PolicyTable } from '@/components/PolicyTable';
import { Badge, Button, Card, DL, EmptyState, ErrorState, LinkButton, Modal, PageHeader, PageLoader, toast } from '@/components/ui';

export default function CustomerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [vehicleModal, setVehicleModal] = useState<Vehicle | 'new' | null>(null);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer>(`/api/customers/${id}`) });
  const policies = useQuery({
    queryKey: ['policies', 'customer', id],
    queryFn: () => api<Paged<PolicyListItem>>('/api/policies', { query: { customerId: id, status: 'ALL', pageSize: 50 } }),
    enabled: can('policies.view'),
  });
  useDocumentTitle(q.data?.name ?? 'Customer');
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['customer', id] });
    qc.invalidateQueries({ queryKey: ['customers'] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/app/customers', label: 'Customers' }}
        title={c.name}
        subtitle={`Customer since ${formatDate(c.createdAt)}`}
        actions={
          <>
            {can('customers.update') && (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {can('policies.issue') && (
              <LinkButton to={`/app/issue?customer=${c.id}`} icon={FilePlus2}>
                Issue RSA
              </LinkButton>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Customer details" className="lg:col-span-1">
          <DL
            cols={1}
            items={[
              { label: 'Mobile', value: c.mobile },
              { label: 'Email', value: c.email },
              { label: 'Date of birth', value: c.dob ? formatDate(c.dob) : null },
              { label: 'Address', value: `${c.address}, ${c.city}, ${c.state} - ${c.pincode}` },
            ]}
          />
        </Card>
        <Card
          title="Vehicles"
          subtitle={`${c.vehicles?.length ?? 0} registered`}
          className="lg:col-span-2"
          padded={false}
          actions={
            can('vehicles.create') && (
              <Button size="sm" icon={Plus} onClick={() => setVehicleModal('new')}>
                Add vehicle
              </Button>
            )
          }
        >
          {c.vehicles?.length ? (
            <ul className="divide-y divide-slate-100">
              {c.vehicles.map((v) => {
                const Icon = v.vehicleType === 'TWO_WHEELER' ? Bike : v.vehicleType === 'FOUR_WHEELER' ? Car : Truck;
                return (
                  <li key={v.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                        <Icon className="size-5" />
                      </span>
                      <div className="text-sm">
                        <p className="font-semibold text-slate-900">
                          {v.make} {v.model} <span className="font-normal text-slate-500">· {v.variant}</span>
                        </p>
                        <p className="font-mono text-xs text-slate-600">
                          {v.registrationNo ?? 'New'} · Chassis {v.chassisNo ?? '—'} · Engine {v.engineNo ?? '—'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {vehicleTypeLabel(v.vehicleType)} · {fuelTypeLabel(v.fuelType)} · {v.manufacturingYear}
                        </p>
                        {v.activePolicy && (
                          <span className="mt-1.5 inline-flex">
                            <Badge tone="green">Covered till {formatDate(v.activePolicy.endDate)}</Badge>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {can('vehicles.update') && (
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setVehicleModal(v)}>
                          Edit
                        </Button>
                      )}
                      {v.activePolicy
                        ? can('policies.renew') &&
                          v.activePolicy.status === 'ACTIVE' &&
                          inRenewalWindow(v.activePolicy.endDate) && (
                            <LinkButton size="sm" variant="outline" icon={RefreshCw} to={`/app/issue?renew=${v.activePolicy.id}`}>
                              Renew
                            </LinkButton>
                          )
                        : can('policies.issue') && (
                            <LinkButton size="sm" variant="outline" icon={FilePlus2} to={`/app/issue?vehicle=${v.id}`}>
                              Issue RSA
                            </LinkButton>
                          )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Car} title="No vehicles yet" description="Add the customer's vehicle to issue an RSA certificate." />
          )}
        </Card>
      </div>
      {can('policies.view') && (
        <Card title="Policy history" padded={false}>
          <PolicyTable rows={policies.data?.items} loading={policies.isLoading} empty={<EmptyState title="No policies yet" />} />
        </Card>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit customer" size="lg">
        <CustomerForm
          initial={c}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success('Customer updated');
            refresh();
          }}
        />
      </Modal>
      <Modal open={!!vehicleModal} onClose={() => setVehicleModal(null)} title={vehicleModal === 'new' ? 'Add vehicle' : 'Edit vehicle'} size="lg">
        {vehicleModal && (
          <VehicleForm
            customerId={c.id}
            initial={vehicleModal === 'new' ? null : vehicleModal}
            onCancel={() => setVehicleModal(null)}
            onSaved={() => {
              setVehicleModal(null);
              toast.success('Vehicle saved');
              refresh();
              qc.invalidateQueries({ queryKey: ['vehicles'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
