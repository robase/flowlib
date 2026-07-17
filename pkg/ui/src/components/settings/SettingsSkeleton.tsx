import React from 'react';
import { Skeleton } from '../ui/skeleton';

export const SettingsSkeleton: React.FC = () => {
  return (
    <div className="space-y-10" aria-hidden="true">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="divide-y divide-border rounded-lg border border-border bg-card px-6">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-center justify-between gap-6 py-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-9 w-full max-w-64" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
