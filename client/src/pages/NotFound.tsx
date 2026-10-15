import { Compass } from 'lucide-react';
import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-brand-50 text-brand-700">
        <Compass className="size-7" />
      </span>
      <h1 className="mt-5 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-slate-500">The page you are looking for does not exist or you do not have access to it.</p>
      <LinkButton to="/" className="mt-6">
        Go to dashboard
      </LinkButton>
    </div>
  );
}
