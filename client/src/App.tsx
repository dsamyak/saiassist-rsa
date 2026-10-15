import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/Layout';
import { PageLoader, Toaster } from './components/ui';
import type { SessionUser } from './lib/types';

const Login = lazy(() => import('./pages/Login'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const Verify = lazy(() => import('./pages/Verify'));
const NotFound = lazy(() => import('./pages/NotFound'));

const DealerDashboard = lazy(() => import('./pages/dealer/Dashboard'));
const IssueWizard = lazy(() => import('./pages/dealer/IssueWizard'));
const Customers = lazy(() => import('./pages/dealer/Customers'));
const CustomerDetail = lazy(() => import('./pages/dealer/CustomerDetail'));
const Vehicles = lazy(() => import('./pages/dealer/Vehicles'));
const Employees = lazy(() => import('./pages/dealer/Employees'));
const DealerSettings = lazy(() => import('./pages/dealer/Settings'));

const Policies = lazy(() => import('./pages/shared/Policies'));
const PolicyDetail = lazy(() => import('./pages/shared/PolicyDetail'));
const Payments = lazy(() => import('./pages/shared/Payments'));
const Cancellations = lazy(() => import('./pages/shared/Cancellations'));
const Reports = lazy(() => import('./pages/shared/Reports'));
const Audit = lazy(() => import('./pages/shared/Audit'));

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const Dealers = lazy(() => import('./pages/admin/Dealers'));
const DealerForm = lazy(() => import('./pages/admin/DealerForm'));
const DealerDetail = lazy(() => import('./pages/admin/DealerDetail'));
const Products = lazy(() => import('./pages/admin/Products'));
const ProductForm = lazy(() => import('./pages/admin/ProductForm'));
const PlatformSettings = lazy(() => import('./pages/admin/PlatformSettings'));
const PlatformUsers = lazy(() => import('./pages/admin/PlatformUsers'));

function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Signing you in…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (session.user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

function RequireRole({ roles }: { roles: SessionUser['role'][] }) {
  const { session } = useAuth();
  if (!session || !roles.includes(session.user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Home() {
  const { session } = useAuth();
  return <Navigate to={session?.user.role === 'SUPER_ADMIN' ? '/admin' : '/app'} replace />;
}

const DEALER: SessionUser['role'][] = ['DEALER_ADMIN', 'DEALER_EMPLOYEE'];

export function App() {
  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:policyNumber" element={<Verify />} />
          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePassword />} />
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="/app" element={<RequireRole roles={DEALER} />}>
                <Route index element={<DealerDashboard />} />
                <Route path="issue" element={<IssueWizard />} />
                <Route path="policies" element={<Policies />} />
                <Route path="policies/:id" element={<PolicyDetail />} />
                <Route path="customers" element={<Customers />} />
                <Route path="customers/:id" element={<CustomerDetail />} />
                <Route path="vehicles" element={<Vehicles />} />
                <Route path="payments" element={<Payments />} />
                <Route path="cancellations" element={<Cancellations />} />
                <Route path="reports" element={<Reports />} />
                <Route path="employees" element={<Employees />} />
                <Route path="settings" element={<DealerSettings />} />
                <Route path="audit" element={<Audit />} />
              </Route>
              <Route path="/admin" element={<RequireRole roles={['SUPER_ADMIN']} />}>
                <Route index element={<AdminDashboard />} />
                <Route path="dealers" element={<Dealers />} />
                <Route path="dealers/new" element={<DealerForm />} />
                <Route path="dealers/:id" element={<DealerDetail />} />
                <Route path="products" element={<Products />} />
                <Route path="products/new" element={<ProductForm />} />
                <Route path="products/:id" element={<ProductForm />} />
                <Route path="policies" element={<Policies />} />
                <Route path="policies/:id" element={<PolicyDetail />} />
                <Route path="payments" element={<Payments />} />
                <Route path="cancellations" element={<Cancellations />} />
                <Route path="reports" element={<Reports />} />
                <Route path="audit" element={<Audit />} />
                <Route path="users" element={<PlatformUsers />} />
                <Route path="settings" element={<PlatformSettings />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}
