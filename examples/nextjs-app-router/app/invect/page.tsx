'use client';

import dynamic from 'next/dynamic';
import '@flowlib/ui/styles';

const Invect = dynamic(() => import('@flowlib/ui').then((mod) => ({ default: mod.Invect })), {
  ssr: false,
});

export default function InvectPage() {
  return (
    <div className="w-full h-full">
      <Invect
        config={{
          apiPath: '/api/flowlib',
          frontendPath: '/flowlib',
        }}
      />
    </div>
  );
}
