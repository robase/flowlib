/**
 * DemoFlowlib — Full Flowlib UI powered by static demo data.
 *
 * Renders the complete Flowlib dashboard (sidebar, flow editor, credentials page, etc.)
 * without requiring a backend server. All API calls resolve from the provided DemoData.
 *
 * @example
 * ```tsx
 * import { DemoFlowlib } from '@flowlib/ui/demo';
 * import '@flowlib/ui/styles';
 *
 * const demoData = {
 *   flows: [{ id: 'flow-1', name: 'My Flow', ... }],
 *   flowReactFlowData: { 'flow-1': { nodes: [...], edges: [...], ... } },
 *   nodeDefinitions: [...],
 * };
 *
 * <div style={{ height: '600px' }}>
 *   <DemoFlowlib data={demoData} />
 * </div>
 * ```
 */

import React, { useEffect, useMemo } from 'react';
import { Flowlib, type FlowlibConfig, type FlowlibProps } from '../Flowlib';
import { createDemoApiClient, type DemoData } from './demo-api-client';
import type { ApiClient } from '../api/client';
import { useChatStore } from '../components/chat/chat.store';

export interface DemoFlowlibProps extends Omit<FlowlibProps, 'apiClient' | 'config'> {
  /** Static data to power the demo UI */
  data: DemoData;
  /**
   * Optional Flowlib config override. A default config is supplied if omitted;
   * host apps generally don't need to pass this in demo mode.
   */
  config?: FlowlibConfig;
}

const DEFAULT_DEMO_CONFIG: FlowlibConfig = {
  apiPath: 'demo://mock',
  frontendPath: '/',
  theme: 'dark',
};

/**
 * Full Flowlib UI with no backend — all data comes from the `data` prop.
 * Uses MemoryRouter by default so it doesn't affect the host page's URL.
 */
export function DemoFlowlib({
  data,
  useMemoryRouter = true,
  config = DEFAULT_DEMO_CONFIG,
  ...rest
}: DemoFlowlibProps) {
  const mockClient = useMemo(() => createDemoApiClient(data) as unknown as ApiClient, [data]);

  // Open chat panel and pre-select Anthropic + Claude Sonnet 4.6 for the demo.
  // Note: updateSettings resets `model` to null when `credentialId` changes, so
  // these must be two separate calls.
  const setOpen = useChatStore((s) => s.setOpen);
  const updateSettings = useChatStore((s) => s.updateSettings);
  useEffect(() => {
    setOpen(true);
    updateSettings({ credentialId: 'cred-anthropic' });
    updateSettings({ model: 'claude-sonnet-4-6' });
  }, [setOpen, updateSettings]);

  return (
    <Flowlib config={config} apiClient={mockClient} useMemoryRouter={useMemoryRouter} {...rest} />
  );
}
