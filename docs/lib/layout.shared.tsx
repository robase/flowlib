import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Flowlib',
    },
    links: [
      {
        text: 'Documentation',
        url: '/docs',
        active: 'nested-url',
      },
      {
        text: 'Demo',
        url: '/demo',
      },
      {
        text: 'GitHub',
        url: 'https://github.com/robase/flowlib',
        external: true,
      },
    ],
  };
}
