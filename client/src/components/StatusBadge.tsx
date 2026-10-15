import {
  Ban,
  CalendarX2,
  CheckCircle2,
  Clock3,
  FileText,
  Hourglass,
  PauseCircle,
  RefreshCw,
  Undo2,
  XCircle,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { POLICY_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@shared/constants';
import { Badge, type Tone } from './ui';

type Spec = { tone: Tone; icon: ComponentType<LucideProps>; label: string };

const POLICY: Record<string, Spec> = {
  ACTIVE: { tone: 'green', icon: CheckCircle2, label: POLICY_STATUS_LABELS.ACTIVE },
  EXPIRING_SOON: { tone: 'amber', icon: Clock3, label: POLICY_STATUS_LABELS.EXPIRING_SOON },
  EXPIRED: { tone: 'gray', icon: CalendarX2, label: POLICY_STATUS_LABELS.EXPIRED },
  CANCELLED: { tone: 'red', icon: XCircle, label: POLICY_STATUS_LABELS.CANCELLED },
  SUSPENDED: { tone: 'orange', icon: PauseCircle, label: POLICY_STATUS_LABELS.SUSPENDED },
  RENEWED: { tone: 'blue', icon: RefreshCw, label: POLICY_STATUS_LABELS.RENEWED },
  PAYMENT_PENDING: { tone: 'amber', icon: Hourglass, label: POLICY_STATUS_LABELS.PAYMENT_PENDING },
  DRAFT: { tone: 'gray', icon: FileText, label: 'Quotation' },
};

const PAYMENT: Record<string, Spec> = {
  PENDING: { tone: 'amber', icon: Hourglass, label: PAYMENT_STATUS_LABELS.PENDING },
  SUCCESS: { tone: 'green', icon: CheckCircle2, label: PAYMENT_STATUS_LABELS.SUCCESS },
  FAILED: { tone: 'red', icon: XCircle, label: PAYMENT_STATUS_LABELS.FAILED },
  REFUNDED: { tone: 'violet', icon: Undo2, label: PAYMENT_STATUS_LABELS.REFUNDED },
  PARTIALLY_REFUNDED: { tone: 'violet', icon: Undo2, label: PAYMENT_STATUS_LABELS.PARTIALLY_REFUNDED },
};

const CANCELLATION: Record<string, Spec> = {
  REQUESTED: { tone: 'amber', icon: Hourglass, label: 'Awaiting approval' },
  APPROVED: { tone: 'red', icon: Ban, label: 'Cancelled' },
  REJECTED: { tone: 'gray', icon: XCircle, label: 'Rejected' },
};

const render = (map: Record<string, Spec>, status: string) => {
  const s = map[status] ?? { tone: 'gray' as Tone, icon: FileText, label: status };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
};

export const PolicyStatusBadge = ({ status }: { status: string }) => render(POLICY, status);
export const PaymentStatusBadge = ({ status }: { status: string }) => render(PAYMENT, status);
export const CancellationStatusBadge = ({ status }: { status: string }) => render(CANCELLATION, status);
export const ActiveBadge = ({ status }: { status: string }) =>
  status === 'ACTIVE' ? (
    <Badge tone="green" icon={CheckCircle2}>
      Active
    </Badge>
  ) : (
    <Badge tone="gray" icon={PauseCircle}>
      Inactive
    </Badge>
  );
