import { useRef, useState } from 'react';
import { User, X } from 'lucide-react';
import type { AuthUser } from './types';

export function MemberCombobox({
  users,
  excludeIds,
  selectedUserIds,
  onSelect,
}: {
  users: AuthUser[];
  excludeIds: Set<string>;
  selectedUserIds: string[];
  onSelect: (userIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = new Set(selectedUserIds);

  const filteredUsers = users.filter((user) => {
    if (excludeIds.has(user.id)) {
      return false;
    }
    if (selectedSet.has(user.id)) {
      return false;
    }
    const haystack = `${user.name || ''} ${user.email || ''} ${user.id}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const toggle = (userId: string) => {
    onSelect(
      selectedSet.has(userId)
        ? selectedUserIds.filter((id) => id !== userId)
        : [...selectedUserIds, userId],
    );
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
        {selectedUserIds.map((userId) => {
          const user = users.find((u) => u.id === userId);
          const label = user?.name || user?.email || userId;
          return (
            <span
              key={userId}
              className="inline-flex items-center gap-1 rounded-md border border-fl-border bg-fl-muted px-2 py-0.5 text-xs font-medium text-fl-foreground"
            >
              <User className="h-3 w-3 shrink-0 text-fl-muted-foreground" />
              <span className="max-w-[140px] truncate">{label}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(userId);
                }}
                className="ml-0.5 text-fl-muted-foreground hover:text-fl-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selectedUserIds.length === 0 ? 'Search users…' : 'Add more…'}
          className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-fl-muted-foreground"
        />
      </div>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-full overflow-y-auto rounded-md border border-fl-border bg-fl-background shadow-lg top-full max-h-52">
          {filteredUsers.length === 0 ? (
            <div className="px-3 py-2 text-xs text-fl-muted-foreground">
              {query ? 'No matches.' : 'No more users to add.'}
            </div>
          ) : (
            filteredUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  toggle(user.id);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-fl-muted/50"
              >
                <User className="h-4 w-4 shrink-0 text-fl-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{user.name || user.email || user.id}</div>
                  {user.name && user.email && (
                    <div className="truncate text-xs text-fl-muted-foreground">{user.email}</div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
