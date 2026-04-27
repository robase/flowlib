import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">🚀 Acme Dashboard</h1>
        <p className="mt-2 text-lg text-muted">
          Internal admin panel — manage customers, orders, products & workflows
        </p>
      </div>

      <Link
        href="/dashboard"
        className="rounded-md bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
      >
        Open Dashboard
      </Link>

      <div className="mt-4 max-w-md text-center text-sm text-muted">
        <p>
          This example demonstrates <strong>Invect</strong> embedded inside a pre-existing Next.js
          admin dashboard. The app has its own Drizzle schema (customers, products, orders) and
          Invect is added as a &ldquo;Workflows&rdquo; page.
        </p>
        <p className="mt-2">
          Auth is handled by <strong>better-auth</strong>, and the{' '}
          <strong>@flowlib/user-auth</strong> + <strong>@flowlib/rbac</strong> plugins provide
          integrated authentication and role-based access control.
        </p>
      </div>
    </div>
  );
}
