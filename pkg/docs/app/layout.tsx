import localFont from 'next/font/local';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './global.css';

const geistSans = localFont({
  src: '../../ui/src/assets/fonts/geist-latin-wght-normal.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
  weight: '100 900',
});

const iosevkaMono = localFont({
  src: '../../ui/src/assets/fonts/iosevka-latin-400-normal.woff2',
  variable: '--font-iosevka',
  display: 'swap',
  weight: '400',
});

export const metadata = {
  title: {
    template: '%s — Flowlib',
    default: 'Flowlib Docs',
  },
  description: 'Documentation for Flowlib — drop-in workflow orchestration for any Node.js app.',
  icons: { icon: '/favicon.ico' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${iosevkaMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{
            defaultTheme: 'dark',
            enableSystem: false,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
