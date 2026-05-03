/**
 * ChatPanel — Main chat assistant sidebar component.
 *
 * Slim composition shell that wires up hooks and composes
 * ChatMessageList, ChatInput, and ChatSettingsPanel.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { MessageSquare, X, Trash2, Bot, Settings2 } from 'lucide-react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '~/components/ui/tooltip';
import { useChat } from './use-chat';
import { useCredentials } from '~/api/credentials.api';
import { useChatStore } from './chat.store';
import { useDelayedUnmount } from '~/hooks/use-delayed-unmount';
import { ChatSettingsPanel } from './ChatSettingsPanel';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { useToolbarCollapsed } from '~/components/flow-editor/toolbar-context';

const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 340;
const MAX_WIDTH = 700;

// =====================================
// ChatPanel (main export)
// =====================================

interface ChatPanelProps {
  flowId?: string;
  selectedNodeId?: string;
  selectedRunId?: string;
  viewMode?: 'edit' | 'runs';
  basePath?: string;
  className?: string;
}

export function ChatPanel({
  flowId,
  selectedNodeId,
  selectedRunId,
  viewMode,
  basePath,
  className,
}: ChatPanelProps) {
  const {
    sendMessage,
    stopStreaming,
    clearMessages,
    messages,
    isStreaming,
    isLoadingHistory,
    streamingText,
    error,
    isOpen,
    setOpen,
    isSettingsPanelOpen,
    toggleSettingsPanel,
  } = useChat({ flowId, selectedNodeId, selectedRunId, viewMode: viewMode ?? 'edit', basePath });

  // Check if a credential has been selected for the chat assistant
  const credentialId = useChatStore((s) => s.settings.credentialId);
  const { data: llmCredentials = [], isLoading: isLoadingCredentials } = useCredentials({
    type: 'llm',
    isActive: true,
  });
  const hasAvailableLlmCredentials = llmCredentials.length > 0;
  const hasSelectedCredential = useMemo(
    () =>
      Boolean(credentialId && llmCredentials.some((credential) => credential.id === credentialId)),
    [credentialId, llmCredentials],
  );
  const hasConfiguredCredential = credentialId
    ? isLoadingCredentials || hasSelectedCredential
    : false;

  // Consume pending prompt from overlay (fires once when panel opens with a queued prompt)
  const pendingConsumed = useRef(false);
  useEffect(() => {
    if (!isOpen || isStreaming || pendingConsumed.current || !hasConfiguredCredential) {
      return;
    }
    const prompt = useChatStore.getState().consumePendingPrompt();
    if (prompt) {
      pendingConsumed.current = true;
      setTimeout(() => {
        sendMessage(prompt);
        pendingConsumed.current = false;
      }, 50);
    }
  }, [hasConfiguredCredential, isOpen, isStreaming, sendMessage]);

  // --- Resize logic ---
  const [panelWidth, setPanelWidth] = React.useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) {
          return;
        }
        const delta = startX - ev.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setPanelWidth(next);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [panelWidth],
  );

  const { shouldRender, isVisible } = useDelayedUnmount(isOpen, 200);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className="flex justify-end shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out"
      style={{ width: isVisible ? panelWidth : 0, opacity: isVisible ? 1 : 0 }}
    >
      <div
        className={cn(
          'relative flex flex-col h-full border-l border-border bg-fl-background text-card-foreground',
          className,
        )}
        style={{ width: panelWidth, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
      >
        {/* Resize handle on left edge */}
        <div
          onMouseDown={startResize}
          className="absolute inset-y-0 left-0 z-20 w-1 transition-colors cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
        />
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <span className="text-sm font-semibold">Chat</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={isSettingsPanelOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={toggleSettingsPanel}
              title="Chat settings"
            >
              <Settings2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearMessages}
              title="Clear chat"
              disabled={isStreaming || messages.length === 0}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} title="Close">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Settings Panel (slide-over) */}
        {isSettingsPanelOpen && (
          <div className="absolute inset-0 z-30 flex flex-col bg-fl-background">
            <ChatSettingsPanel onClose={toggleSettingsPanel} />
          </div>
        )}

        {/* Messages */}
        <ChatMessageList
          messages={messages}
          isStreaming={isStreaming}
          isLoadingHistory={isLoadingHistory}
          streamingText={streamingText}
          error={error}
          hasConfiguredCredential={hasConfiguredCredential}
          hasAvailableLlmCredentials={hasAvailableLlmCredentials}
          onOpenSettings={toggleSettingsPanel}
          onSendMessage={sendMessage}
        />

        {/* Input */}
        <ChatInput
          isStreaming={isStreaming}
          isLoadingHistory={isLoadingHistory}
          hasConfiguredCredential={hasConfiguredCredential}
          hasAvailableLlmCredentials={hasAvailableLlmCredentials}
          onSend={sendMessage}
          onStop={stopStreaming}
          onOpenSettings={toggleSettingsPanel}
        />
      </div>
    </div>
  );
}

// =====================================
// ChatToggleButton (for toolbar)
// =====================================

export function ChatToggleButton({ className }: { className?: string }) {
  const { isOpen, togglePanel } = useChat();
  const collapsed = useToolbarCollapsed();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePanel}
          aria-label={isOpen ? 'Close Assistant' : 'Open Assistant'}
          title={collapsed ? undefined : isOpen ? 'Close Assistant' : 'Open Assistant'}
          className={cn(
            'gap-1.5 hover:bg-accent',
            isOpen
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          <MessageSquare className="size-4.5" />
          {!collapsed && <span className="text-xs font-medium">Chat</span>}
        </Button>
      </TooltipTrigger>
      {collapsed && (
        <TooltipContent side="left">{isOpen ? 'Close Assistant' : 'Open Assistant'}</TooltipContent>
      )}
    </Tooltip>
  );
}
