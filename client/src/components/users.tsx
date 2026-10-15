import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { DEALER_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, ROLE_LABELS } from '@shared/constants';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { User } from '@/lib/types';
import { ActiveBadge } from './StatusBadge';
import { Alert, Badge, Button, Checkbox, DataTable, Field, Input, Modal, Switch, toast, type Column } from './ui';

export function PermissionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const groups = [...new Set(DEALER_PERMISSIONS.map((p) => p.group))];
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</p>
          <div className="space-y-2.5">
            {DEALER_PERMISSIONS.filter((p) => p.group === g).map((p) => (
              <Checkbox key={p.key} label={p.label} checked={value.includes(p.key)} onChange={() => toggle(p.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TempPasswordModal({ data, onClose }: { data: { email: string; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open={!!data}
      onClose={onClose}
      title="Temporary password"
      description="Share it securely. It is shown only once and must be changed at first sign-in."
      size="sm"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {data && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Sign-in email: <span className="font-medium text-slate-900">{data.email}</span>
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <KeyRound className="size-4 text-slate-400" />
            <code className="flex-1 font-mono text-base font-semibold tracking-wide text-slate-900">{data.password}</code>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? Check : Copy}
              onClick={async () => {
                await navigator.clipboard.writeText(data.password);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface UserFormState {
  name: string;
  email: string;
  mobile: string;
  password: string;
  permissions: string[];
  status: 'ACTIVE' | 'INACTIVE';
  role: User['role'];
}

/** Create / edit dialog for dealer staff and platform users. */
export function UserDialog({
  open,
  onClose,
  user,
  createPath,
  updatePath,
  showPermissions,
  allowRoleChange,
  onSaved,
  title,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
  createPath: string;
  updatePath: (id: string) => string;
  showPermissions: boolean;
  allowRoleChange?: boolean;
  onSaved: (res: { user: User; temporaryPassword?: string }) => void;
  title?: string;
}) {
  const [form, setForm] = useState<UserFormState>(() => initForm(user));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUser, setLastUser] = useState<User | null | undefined>(undefined);
  if (lastUser !== user && open) {
    setLastUser(user);
    setForm(initForm(user));
    setError(null);
  }
  const isEmployee = form.role === 'DEALER_EMPLOYEE';
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (user) {
        const body: Record<string, unknown> = { name: form.name, mobile: form.mobile || null, status: form.status };
        if (showPermissions && isEmployee) body.permissions = form.permissions;
        if (allowRoleChange) body.role = form.role;
        const updated = await api<User>(updatePath(user.id), { method: 'PUT', body });
        onSaved({ user: updated });
      } else {
        const res = await api<{ user: User; temporaryPassword: string; generated: boolean }>(createPath, {
          method: 'POST',
          body: {
            name: form.name,
            email: form.email,
            mobile: form.mobile || null,
            password: form.password || null,
            permissions: showPermissions ? form.permissions : undefined,
            role: allowRoleChange ? form.role : undefined,
          },
        });
        onSaved({ user: res.user, temporaryPassword: res.generated ? res.temporaryPassword : undefined });
      }
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
      title={title ?? (user ? 'Edit user' : 'Add user')}
      size={showPermissions ? 'xl' : 'md'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email (sign-in ID)" required={!user}>
            <Input type="email" value={form.email} disabled={!!user} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Mobile">
            <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} inputMode="tel" />
          </Field>
          {!user ? (
            <Field label="Initial password" hint="Leave blank to generate a temporary password">
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
          ) : (
            <div className="flex items-end pb-2">
              <Switch checked={form.status === 'ACTIVE'} onChange={(v) => setForm({ ...form, status: v ? 'ACTIVE' : 'INACTIVE' })} label="Account active" description="Inactive users cannot sign in" />
            </div>
          )}
          {allowRoleChange && (
            <Field label="Role">
              <select
                className="block h-10 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-inset ring-slate-300"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}
              >
                <option value="DEALER_ADMIN">{ROLE_LABELS.DEALER_ADMIN}</option>
                <option value="DEALER_EMPLOYEE">{ROLE_LABELS.DEALER_EMPLOYEE}</option>
              </select>
            </Field>
          )}
        </div>
        {showPermissions && isEmployee && (
          <div className="rounded-xl bg-slate-50/70 p-4 ring-1 ring-slate-200">
            <p className="mb-4 text-sm font-semibold text-slate-900">Permissions</p>
            <PermissionPicker value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />
          </div>
        )}
        {showPermissions && !isEmployee && <p className="text-sm text-slate-500">Dealer Admins have every permission in their dealership.</p>}
      </div>
    </Modal>
  );
}

function initForm(user: User | null): UserFormState {
  return {
    name: user?.name ?? '',
    email: user?.email ?? '',
    mobile: user?.mobile ?? '',
    password: '',
    permissions: user?.permissions ?? [...DEFAULT_EMPLOYEE_PERMISSIONS],
    status: user?.status ?? 'ACTIVE',
    role: user?.role ?? 'DEALER_EMPLOYEE',
  };
}

export function UsersTable({ rows, loading, onEdit, onReset }: { rows: User[] | undefined; loading?: boolean; onEdit?: (u: User) => void; onReset?: (u: User) => void }) {
  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'User',
      cell: (u) => (
        <div>
          <p className="font-medium text-slate-900">{u.name}</p>
          <p className="text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: (u) => <Badge tone={u.role === 'DEALER_EMPLOYEE' ? 'gray' : 'blue'}>{ROLE_LABELS[u.role]}</Badge> },
    {
      key: 'perms',
      header: 'Permissions',
      cell: (u) => (u.role === 'DEALER_EMPLOYEE' ? `${u.permissions.length} of ${DEALER_PERMISSIONS.length}` : 'All'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          <ActiveBadge status={u.status} />
          {u.mustChangePassword && <Badge tone="amber">Password change pending</Badge>}
          {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red">Locked</Badge>}
        </div>
      ),
    },
    { key: 'login', header: 'Last sign-in', cell: (u) => <span className="text-xs text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) => (
        <div className="flex justify-end gap-1">
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(u)}>
              Edit
            </Button>
          )}
          {onReset && (
            <Button size="sm" variant="ghost" onClick={() => onReset(u)}>
              Reset password
            </Button>
          )}
        </div>
      ),
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} loading={loading} />;
}

export async function resetUserPassword(path: string, user: User, show: (d: { email: string; password: string }) => void) {
  if (!window.confirm(`Reset the password for ${user.name}? They will be signed out everywhere.`)) return;
  try {
    const r = await api<{ temporaryPassword: string }>(path, { method: 'POST' });
    show({ email: user.email, password: r.temporaryPassword });
  } catch (e) {
    toast.error(errorMessage(e));
  }
}
