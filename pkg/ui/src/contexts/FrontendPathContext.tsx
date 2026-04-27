import React, { createContext, useContext } from 'react';

const FrontendPathContext = createContext<string>('/flowlib');

export interface FrontendPathProviderProps {
  children: React.ReactNode;
  basePath?: string;
}

export function FrontendPathProvider({
  children,
  basePath = '/flowlib',
}: FrontendPathProviderProps) {
  return (
    <FrontendPathContext.Provider value={normalizeBasePath(basePath)}>
      {children}
    </FrontendPathContext.Provider>
  );
}

export function useFrontendPath(): string {
  return useContext(FrontendPathContext);
}

export function buildFrontendRoute(basePath: string, path: string): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBasePath}${normalizedPath}`;
}

export function buildOAuthCallbackUri(origin: string, basePath: string): string {
  return `${origin}${buildFrontendRoute(basePath, '/oauth/callback')}`;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') {
    return '';
  }

  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}
