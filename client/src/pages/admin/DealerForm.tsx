import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { formatMoney, vehicleTypeLabel } from '@/lib/format';
import { useDocumentTitle } from '@/lib/hooks';
import type { Dealer, Product, User } from '@/lib/types';
import { DealerProfileForm, dealerPayload, initDealerForm } from '@/components/DealerProfileForm';
import { TempPasswordModal } from '@/components/users';
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, toast } from '@/components/ui';

export default function DealerForm() {
  useDocumentTitle('Onboard dealer');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => initDealerForm(null));
  const [admin, setAdmin] = useState({ name: '', email: '', mobile: '', password: '' });
  const [productIds, setProductIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ dealer: Dealer; admin: User; temporaryPassword: string } | null>(null);
  const products = useQuery({ queryKey: ['admin-products'], queryFn: () => api<Product[]>('/api/admin/rsa/products') });
  const active = (products.data ?? []).filter((p) => p.status === 'ACTIVE');
  const selected = productIds ?? active.map((p) => p.id);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ dealer: Dealer; admin: User; temporaryPassword: string }>('/api/admin/dealers', {
        method: 'POST',
        body: { ...dealerPayload(form), dealerCode: form.dealerCode, productIds: selected, admin: { ...admin, mobile: admin.mobile || null, password: admin.password || null } },
      });
      qc.invalidateQueries({ queryKey: ['dealers'] });
      toast.success(`${res.dealer.dealerName} onboarded`);
      if (!admin.password) setCreated(res);
      else navigate(`/admin/dealers/${res.dealer.id}`);
    } catch (e) {
      setError(errorMessage(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/admin/dealers', label: 'Dealers' }} title="Onboard a dealer" subtitle="Creates an isolated dealer workspace, its Dealer Admin account and product access" />
      {error && <Alert tone="error">{error}</Alert>}
      <DealerProfileForm value={form} onChange={setForm} mode="create" />
      <Card title="RSA products" subtitle="Plans this dealer can sell (pricing can be customised after onboarding)">
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((p) => (
            <Checkbox
              key={p.id}
              checked={selected.includes(p.id)}
              onChange={() => setProductIds(selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
              label={`${p.planName} (${p.productCode})`}
              description={`${p.vehicleTypes.map(vehicleTypeLabel).join(', ')} · from ${formatMoney(p.terms[0]?.price)}`}
            />
          ))}
        </div>
      </Card>
      <Card title="Dealer Admin account" subtitle="The first user of the dealer workspace; they can add their own employees">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} />
          </Field>
          <Field label="Email (sign-in ID)" required>
            <Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
          </Field>
          <Field label="Mobile">
            <Input value={admin.mobile} onChange={(e) => setAdmin({ ...admin, mobile: e.target.value })} />
          </Field>
          <Field label="Initial password" hint="Leave blank to generate a temporary password">
            <Input value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate('/admin/dealers')}>
          Cancel
        </Button>
        <Button size="lg" loading={busy} onClick={submit}>
          Create dealer workspace
        </Button>
      </div>
      <TempPasswordModal
        data={created ? { email: created.admin.email, password: created.temporaryPassword } : null}
        onClose={() => navigate(`/admin/dealers/${created!.dealer.id}`)}
      />
    </div>
  );
}
