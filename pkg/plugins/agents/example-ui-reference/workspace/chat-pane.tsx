'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Sparkles, Plug, ChevronsUpDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentSession, ChatMessage } from '@/lib/workspace/types';
import { StatusDot } from './status-dot';
import { MessageBubble } from './message-bubble';

const MODELS = ['Default model', 'claude-opus-4.6', 'gpt-5-mini', 'gemini-3-flash'];
const PROVIDERS = ['openrouter', 'anthropic', 'openai', 'ai-gateway'];

interface ChatPaneProps {
  session: AgentSession;
  messages: ChatMessage[];
  sending: boolean;
  onSend: (text: string) => void;
}

export function ChatPane({ session, messages, sending, onSend }: ChatPaneProps) {
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState(MODELS[0]);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  function submit() {
    if (!draft.trim() || sending) {
      return;
    }
    onSend(draft);
    setDraft('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-3xl px-5 pb-6">
            {/* Inline header — sticky to top-left of the message column */}
            <header className="sticky top-0 z-10 -mx-5 flex items-center gap-2 bg-background/90 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
              <StatusDot status={session.status} />
              <h1 className="truncate text-sm font-semibold tracking-tight">{session.title}</h1>
            </header>

            <div className="space-y-6 pt-4">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Agent is working…
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Composer */}
      <div className="border-t border-border px-5 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-col gap-2 rounded-xl border border-input bg-card p-2.5 focus-within:ring-1 focus-within:ring-ring">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask about your flow…"
              className="max-h-40 min-h-9 w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
              aria-label="Message the agent"
            />
            <div className="flex items-center gap-2">
              <ComposerSelect
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label={model}
                options={MODELS}
                value={model}
                onSelect={setModel}
                ariaLabel="Select model"
              />
              <ComposerSelect
                icon={<Plug className="h-3.5 w-3.5" />}
                label={provider}
                options={PROVIDERS}
                value={provider}
                onSelect={setProvider}
                ariaLabel="Select provider"
              />
              <Button
                size="icon"
                className="ml-auto h-9 w-9 shrink-0"
                onClick={submit}
                disabled={!draft.trim() || sending}
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ComposerSelectProps {
  icon: React.ReactNode;
  label: string;
  options: string[];
  value: string;
  onSelect: (value: string) => void;
  ariaLabel: string;
}

function ComposerSelect({ icon, label, options, value, onSelect, ariaLabel }: ComposerSelectProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {icon}
        <span className="max-w-32 truncate">{label}</span>
        <ChevronsUpDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {options.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onSelect(option)} className="text-sm">
            <span className="flex-1 truncate">{option}</span>
            {option === value && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
