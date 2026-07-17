/**
 * SkillsPanel — the org's authored skills.
 *
 * Wired to the real `/skills` catalogue. Skills are always available to
 * the agent's prompt (progressive disclosure); there is no per-session
 * toggle, so the dot reflects scope: `global` skills (org-wide) are
 * treated as active; `personal` skills as owner-scoped.
 */
import * as React from 'react';
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react';
import type { AgentSkill } from '../../../shared/types';
import { useSkills } from '../../hooks/useSkills';
import { cn } from '../../lib/cn';

export function SkillsPanel(): React.ReactElement {
  const { data: skills, isLoading, error } = useSkills();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selected = skills?.find((s) => s.id === selectedId) ?? null;

  if (selected) {
    return <SkillDetail skill={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading skills…
          </div>
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive">
            Failed to load skills: {(error as Error).message}
          </p>
        ) : !skills || skills.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No skills authored yet.</p>
        ) : (
          skills.map((skill) => (
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
                    skill.scope === 'global' ? 'bg-success' : 'bg-muted-foreground/40',
                  )}
                  aria-label={skill.scope === 'global' ? 'Org-wide' : 'Personal'}
                />
                <code className="truncate font-mono text-sm font-medium text-foreground">
                  {skill.name}
                </code>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {skill.description}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SkillDetail({
  skill,
  onBack,
}: {
  skill: AgentSkill;
  onBack: () => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-2 pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to skills"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{skill.name}</code>
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
