'use client';

import dynamic from 'next/dynamic';
import '@flowlib/ui/styles';

const Flowlib = dynamic(() => import('@flowlib/ui').then((mod) => ({ default: mod.Flowlib })), {
  ssr: false,
});

export default function FlowlibPage() {
  return (
    <div className="w-full h-full">
      <Flowlib
        config={{
          apiPath: '/api/flowlib',
          frontendPath: '/flowlib',
        }}
      />
    </div>
  );
}
