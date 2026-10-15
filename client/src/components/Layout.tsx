import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  BarChart3,
  Building2,
  Car,
  ChevronDown,
  FilePlus2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  QrCode,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideProps,
} from 'lucide-react';
import { ROLE_LABELS } from '@shared/constants';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { BrandLockup } from './Brand';
import { cn } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  end?: boolean;
  badge?: number;
}

function useNav(): { section?: string; items: NavItem[] }[] {
  const { session, can } = useAuth();
  const isSuper = session?.user.role === 'SUPER_ADMIN';
  const isDealerAdmin = session?.user.role === 'DEALER_ADMIN';
  const { data: pending } = useQuery({
    queryKey: ['cancellations', 'pending-count'],
    queryFn: () => api<unknown[]>('/api/cancellations', { query: { status: 'REQUESTED' } }),
    enabled: can('policies.cancel'),
    refetchInterval: 60_000,
  });
  const pendingCount = pending?.length || undefined;
  if (isSuper) {
    return [
      {
        items: [
          { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
          { to: '/admin/dealers', label: 'Dealers', icon: Building2 },
          { to: '/admin/products', label: 'RSA Products', icon: Package },
          { to: '/admin/policies', label: 'All Policies', icon: ShieldCheck },
          { to: '/admin/payments', label: 'Payments', icon: Wallet },
          { to: '/admin/cancellations', label: 'Cancellations', icon: Ban, badge: pendingCount },
          { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
        ],
      },
      {
        section: 'Platform',
        items: [
          { to: '/admin/settings', label: 'Settings & Template', icon: Settings },
          { to: '/admin/users', label: 'Platform Users', icon: UserCog },
          { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
        ],
      },
    ];
  }
  const main: NavItem[] = [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }];
  if (can('policies.issue') || can('policies.quote')) main.push({ to: '/app/issue', label: 'Issue RSA', icon: FilePlus2 });
  if (can('policies.view')) main.push({ to: '/app/policies', label: 'Policies', icon: ShieldCheck });
  main.push({ to: '/app/customers', label: 'Customers', icon: Users }, { to: '/app/vehicles', label: 'Vehicles', icon: Car });
  if (can('payments.view')) main.push({ to: '/app/payments', label: 'Payments', icon: Wallet });
  if (can('policies.cancel')) main.push({ to: '/app/cancellations', label: 'Cancellations', icon: Ban, badge: pendingCount });
  if (can('reports.view')) main.push({ to: '/app/reports', label: 'Reports', icon: BarChart3 });
  const groups: { section?: string; items: NavItem[] }[] = [{ items: main }];
  if (isDealerAdmin) {
    groups.push({
      section: 'Administration',
      items: [
        { to: '/app/employees', label: 'Employees', icon: UserCog },
        { to: '/app/settings', label: 'Dealer Settings', icon: Settings },
        { to: '/app/audit', label: 'Audit Log', icon: ScrollText },
      ],
    });
  }
  return groups;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useAuth();
  const groups = useNav();
  return (
    <div className="flex h-full flex-col bg-brand-950 text-slate-300">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link to="/" onClick={onNavigate}>
          <BrandLockup name={session?.platform.name ?? 'SaiAssist RSA'} dark />
        </Link>
      </div>
      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {groups.map((g, i) => (
          <div key={i}>
            {g.section && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.section}</p>}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <it.icon className={cn('size-[18px] shrink-0', isActive ? 'text-gold-400' : 'text-slate-400 group-hover:text-slate-200')} />
                        <span className="flex-1">{it.label}</span>
                        {it.badge ? (
                          <span className="rounded-full bg-gold-400 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-brand-950">{it.badge}</span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <Link to="/verify" target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-white">
          <QrCode className="size-4" /> Public verification page
        </Link>
      </div>
    </div>
  );
}

function UserMenu() {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!session) return null;
  const u = session.user;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100">
        <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials(u.name)}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-800">{u.name}</span>
          <span className="block text-xs leading-tight text-slate-500">{ROLE_LABELS[u.role]}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" />
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 z-40 mt-2 w-60 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-slate-900">{u.name}</p>
            <p className="truncate text-xs text-slate-500">{u.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/change-password');
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <KeyRound className="size-4 text-slate-400" /> Change password
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { session } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);
  const dealer = session?.dealer;
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <div className="animate-fade-in absolute inset-y-0 left-0 w-72 shadow-xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-300 hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {dealer ? (
              <>
                {dealer.logoUrl ? (
                  <img src={dealer.logoUrl} alt="" className="hidden h-9 max-w-[120px] object-contain sm:block" />
                ) : (
                  <span className="hidden size-9 place-items-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-800 sm:grid">{initials(dealer.name)}</span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{dealer.name}</p>
                  <p className="truncate text-xs text-slate-500">Dealer workspace · {dealer.code}</p>
                </div>
              </>
            ) : (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">Platform Administration</p>
                <p className="truncate text-xs text-slate-500">All dealers · central configuration</p>
              </div>
            )}
          </div>
          <UserMenu />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
