'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Skill } from '@/lib/workspace/types';

export function SkillsPanel({
  skills,
  onToggle,
}: {
  skills: Skill[];
  onToggle: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = skills.find((s) => s.id === selectedId) ?? null;

  if (selected) {
    return <SkillDetail skill={selected} onBack={() => setSelectedId(null)} onToggle={onToggle} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {skills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            onClick={() => setSelectedId(skill.id)}
            className="block w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  skill.enabled ? 'bg-success' : 'bg-muted-foreground/40',
                )}
                aria-label={skill.enabled ? 'Enabled' : 'Disabled'}
              />
              <code className="truncate font-mono text-sm font-medium text-foreground">
                {skill.name}
              </code>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {skill.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function SkillDetail({
  skill,
  onBack,
  onToggle,
}: {
  skill: Skill;
  onBack: () => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-2 pb-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onBack}
          aria-label="Back to skills"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{skill.name}</code>
        <Switch
          checked={skill.enabled}
          onCheckedChange={() => onToggle(skill.id)}
          aria-label="Toggle skill"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
        <p className="text-sm leading-relaxed text-muted-foreground">{skill.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize">{skill.scope}</span>
          {skill.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>

        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground">
          {skill.body}
        </pre>
      </div>
    </div>
  );
}
