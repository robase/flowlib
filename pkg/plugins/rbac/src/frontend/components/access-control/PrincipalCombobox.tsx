import { useRef, useState } from 'react';
import { User, Users, X } from 'lucide-react';
import type { Team } from '../../../shared/types';
import type { AuthUser, PrincipalSelection } from './types';

export function PrincipalCombobox({
  users,
  teams,
  excludeUserIds,
  excludeTeamIds,
  selections,
  onSelect,
}: {
  users: AuthUser[];
  teams: Team[];
  excludeUserIds: Set<string | null | undefined>;
  excludeTeamIds: Set<string | null | undefined>;
  selections: PrincipalSelection[];
  onSelect: (selections: PrincipalSelection[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedUserIds = new Set(selections.filter((s) => s.type === 'user').map((s) => s.id));
  const selectedTeamIds = new Set(selections.filter((s) => s.type === 'team').map((s) => s.id));

  const filteredUsers = users.filter((user) => {
    if (excludeUserIds.has(user.id)) {
      return false;
    }
    if (selectedUserIds.has(user.id)) {
      return false;
    }
    const haystack = `${user.name || ''} ${user.email || ''} ${user.id}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const filteredTeams = teams.filter((team) => {
    if (excludeTeamIds.has(team.id)) {
      return false;
    }
    if (selectedTeamIds.has(team.id)) {
      return false;
    }
    const haystack = `${team.name} ${team.description || ''}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const toggle = (sel: PrincipalSelection) => {
    const exists = selections.some((s) => s.type === sel.type && s.id === sel.id);
    onSelect(
      exists
        ? selections.filter((s) => !(s.type === sel.type && s.id === sel.id))
        : [...selections, sel],
    );
  };

  const getLabel = (sel: PrincipalSelection): string => {
    if (sel.type === 'user') {
      const user = users.find((u) => u.id === sel.id);
      return user?.name || user?.email || sel.id;
    }
    return teams.find((t) => t.id === sel.id)?.name || sel.id;
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(e) => {
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <div
        className="flex min-h-[2.5rem] w-full cursor-text flex-wrap gap-1.5 rounded-md border border-fl-border bg-fl-background px-2 py-1.5 focus-within:border-fl-primary/50"
        onClick={() => setOpen(true)}
      >
        {selections.map((sel) => (
          <span
            key={`${sel.type}:${sel.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-fl-border bg-fl-muted px-2 py-0.5 text-xs font-medium text-fl-foreground"
          >
            {sel.type === 'user' ? (
              <User className="h-3 w-3 shrink-0 text-fl-muted-foreground" />
            ) : (
              <Users className="h-3 w-3 shrink-0 text-fl-muted-foreground" />
            )}
            <span className="max-w-[140px] truncate">{getLabel(sel)}</span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                toggle(sel);
              }}
              className="ml-0.5 text-fl-muted-foreground hover:text-fl-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selections.length === 0 ? 'Search users or teams…' : 'Add more…'}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-fl-muted-foreground"
        />
      </div>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-full overflow-y-auto rounded-md border border-fl-border bg-fl-background shadow-lg top-full max-h-52">
          {filteredTeams.length === 0 && filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fl-muted-foreground">
              {query ? 'No matches.' : 'No more users or teams to add.'}
            </div>
          ) : (
            <>
              {filteredTeams.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fl-muted-foreground">
                    Teams
                  </div>
                  {filteredTeams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        toggle({ type: 'team', id: team.id });
                        setQuery('');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fl-muted/50"
                    >
                      <Users className="h-4 w-4 shrink-0 text-fl-muted-foreground" />
                      <span className="truncate font-medium">{team.name}</span>
                    </button>
                  ))}
                </>
              )}
              {filteredUsers.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-fl-muted-foreground">
                    Users
                  </div>
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        toggle({ type: 'user', id: user.id });
                        setQuery('');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fl-muted/50"
                    >
                      <User className="h-4 w-4 shrink-0 text-fl-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {user.name || user.email || user.id}
                        </div>
                        {user.name && user.email && (
                          <div className="truncate text-xs text-fl-muted-foreground">
                            {user.email}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
