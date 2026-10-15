import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import type { User } from '@/lib/types';
import { TempPasswordModal, UserDialog, UsersTable, resetUserPassword } from '@/components/users';
import { Button, Card, ErrorState, PageHeader, toast } from '@/components/ui';

export default function Employees() {
  useDocumentTitle('Employees');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dealer-users'], queryFn: () => api<User[]>('/api/dealer/users') });
  const [dialog, setDialog] = useState<{ user: User | null } | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Staff who can work in your dealer workspace, and what each one may do"
        actions={
          <Button icon={UserPlus} onClick={() => setDialog({ user: null })}>
            Add employee
          </Button>
        }
      />
      <Card padded={false}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <UsersTable
            rows={q.data}
            loading={q.isLoading}
            onEdit={(u) => (u.role === 'DEALER_EMPLOYEE' ? setDialog({ user: u }) : toast.info('Dealer Admin accounts are managed by the platform administrator'))}
            onReset={(u) => (u.role === 'DEALER_EMPLOYEE' ? resetUserPassword(`/api/dealer/users/${u.id}/reset-password`, u, setTemp) : toast.info('Ask the platform administrator to reset a Dealer Admin password'))}
          />
        )}
      </Card>
      <UserDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        user={dialog?.user ?? null}
        title={dialog?.user ? 'Edit employee' : 'Add employee'}
        createPath="/api/dealer/users"
        updatePath={(id) => `/api/dealer/users/${id}`}
        showPermissions
        onSaved={({ user, temporaryPassword }) => {
          setDialog(null);
          qc.invalidateQueries({ queryKey: ['dealer-users'] });
          toast.success(dialog?.user ? 'Employee updated' : 'Employee added');
          if (temporaryPassword) setTemp({ email: user.email, password: temporaryPassword });
        }}
      />
      <TempPasswordModal data={temp} onClose={() => setTemp(null)} />
    </div>
  );
}
