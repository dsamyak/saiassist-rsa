import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import type { User } from '@/lib/types';
import { TempPasswordModal, UserDialog, UsersTable, resetUserPassword } from '@/components/users';
import { Button, Card, ErrorState, PageHeader, toast } from '@/components/ui';

export default function PlatformUsers() {
  useDocumentTitle('Platform users');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-users'], queryFn: () => api<User[]>('/api/admin/users') });
  const [dialog, setDialog] = useState<{ user: User | null } | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  return (
    <div>
      <PageHeader
        title="Platform users"
        subtitle="Super Admins have full access to every dealer, product and setting"
        actions={
          <Button icon={UserPlus} onClick={() => setDialog({ user: null })}>
            Add Super Admin
          </Button>
        }
      />
      <Card padded={false}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <UsersTable rows={q.data} loading={q.isLoading} onEdit={(u) => setDialog({ user: u })} onReset={(u) => resetUserPassword(`/api/admin/users/${u.id}/reset-password`, u, setTemp)} />
        )}
      </Card>
      <UserDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        user={dialog?.user ?? null}
        title={dialog?.user ? 'Edit Super Admin' : 'Add Super Admin'}
        createPath="/api/admin/users"
        updatePath={(id) => `/api/admin/users/${id}`}
        showPermissions={false}
        onSaved={({ user, temporaryPassword }) => {
          setDialog(null);
          qc.invalidateQueries({ queryKey: ['platform-users'] });
          toast.success('Saved');
          if (temporaryPassword) setTemp({ email: user.email, password: temporaryPassword });
        }}
      />
      <TempPasswordModal data={temp} onClose={() => setTemp(null)} />
    </div>
  );
}
