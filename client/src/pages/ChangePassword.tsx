import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDocumentTitle } from '@/lib/hooks';
import { BrandLockup } from '@/components/Brand';
import { Alert, Button, Field, Input, toast } from '@/components/ui';

export default function ChangePassword() {
  useDocumentTitle('Change password');
  const { session, reload, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!session?.user.mustChangePassword;
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirm) return setError('New password and confirmation do not match');
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      await reload();
      toast.success('Password changed successfully');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <BrandLockup name={session?.platform.name ?? 'SaiAssist RSA'} className="mb-8" />
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <KeyRound className="size-5" />
          </span>
          <h1 className="mt-5 text-xl font-semibold text-slate-900">{forced ? 'Set a new password' : 'Change password'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {forced
              ? 'Your account was created or reset by an administrator. Choose a personal password to continue.'
              : 'Use at least 8 characters with letters and numbers.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label={forced ? 'Temporary password' : 'Current password'} required>
              <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
            </Field>
            <Field label="New password" hint="At least 8 characters, including letters and numbers" required>
              <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
            </Field>
            <Field label="Confirm new password" required>
              <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
            </Field>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              {forced ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign out
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => navigate(-1)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" loading={busy}>
                Update password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
