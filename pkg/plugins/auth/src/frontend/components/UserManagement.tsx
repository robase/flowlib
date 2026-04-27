/**
 * UserManagement — Admin panel for managing users.
 *
 * Displays a list of users with the ability to:
 * - Create new users (email/password/role)
 * - Change user roles
 * - Delete users
 *
 * Only visible to admin users. Uses the auth plugin's
 * `/plugins/auth/users` endpoints.
 */

import { useState, useMemo, useCallback, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronDown,
  Key,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { ApiKeysDialog } from './ApiKeysDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@flowlib/ui';
import { useAuth } from '../providers/AuthProvider';
import {
  AUTH_ADMIN_ROLE,
  AUTH_ASSIGNABLE_ROLES,
  AUTH_DEFAULT_ROLE,
  formatAuthRoleLabel,
  isAuthAssignableRole,
} from '../../shared/roles';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ManagedUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  createdAt?: string;
}

export interface UserManagementProps {
  /** Base URL for the Flowlib API (same as AuthProvider's baseUrl) */
  apiBaseUrl: string;
  /** Additional CSS class names */
  className?: string;
}

const ASSIGNABLE_ROLE_OPTIONS: Array<{
  value: (typeof AUTH_ASSIGNABLE_ROLES)[number];
  label: string;
  description: string;
}> = [
  {
    value: AUTH_DEFAULT_ROLE,
    label: 'None',
    description: 'No global access; flow access can still be granted via RBAC.',
  },
  { value: 'owner', label: 'Owner', description: 'Can edit and manage sharing for all flows.' },
  { value: 'editor', label: 'Editor', description: 'Can inspect, run, and edit flows.' },
  { value: 'operator', label: 'Operator', description: 'Can inspect and run flows.' },
  { value: 'viewer', label: 'Viewer', description: 'Can inspect flows.' },
];

const ROLE_BADGE_CLASSES = 'border-imp-border bg-imp-muted/50 text-imp-foreground';

function getInitials(user: ManagedUser): string {
  if (user.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  if (user.email) {
    return user.email[0].toUpperCase();
  }
  return '?';
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────
// Sortable column header
// ─────────────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  align = 'left',
}: {
  label: string;
  field: 'name' | 'createdAt' | 'role';
  sortField: 'name' | 'createdAt' | 'role';
  sortDir: 'asc' | 'desc';
  onSort: (field: 'name' | 'createdAt' | 'role') => void;
  align?: 'left' | 'right';
}) {
  const active = sortField === field;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th className={`px-4 py-2.5 text-${align} font-medium`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 rounded transition-colors hover:text-imp-foreground ${active ? 'text-imp-foreground' : ''}`}
      >
        {label}
        <Icon className="w-3 h-3 shrink-0" />
      </button>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────
// Role Dropdown
// ─────────────────────────────────────────────────────────────

function RoleDropdown({
  value,
  userId,
  disabled,
  onChange,
}: {
  value: string;
  userId: string;
  disabled: boolean;
  onChange: (userId: string, role: string) => void;
}) {
  const current = isAuthAssignableRole(value) ? value : AUTH_DEFAULT_ROLE;
  const currentLabel = ASSIGNABLE_ROLE_OPTIONS.find((o) => o.value === current)?.label ?? current;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={`inline-flex w-28 items-center justify-between gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium transition-colors hover:bg-imp-muted disabled:cursor-not-allowed disabled:opacity-50 ${ROLE_BADGE_CLASSES}`}
        >
          {currentLabel}
          {!disabled && <ChevronDown className="w-3 h-3 shrink-0" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">Set role</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(userId, option.value)}
            className={`items-start gap-0 px-2 py-2 ${current === option.value ? 'bg-accent text-accent-foreground' : ''}`}
          >
            <div className="min-w-0 text-left">
              <div className="text-sm font-medium">{option.label}</div>
              <div className="text-xs text-muted-foreground">{option.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function UserManagement({ apiBaseUrl, className }: UserManagementProps) {
  const { user, isAuthenticated } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<ManagedUser | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'name' | 'createdAt' | 'role'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [apiKeysEnabled, setApiKeysEnabled] = useState(false);
  const [showApiKeysDialog, setShowApiKeysDialog] = useState(false);
  const [hasCheckedApiKeys, setHasCheckedApiKeys] = useState(false);

  const PAGE_SIZE = 10;

  const handleSort = useCallback((field: 'name' | 'createdAt' | 'role') => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
    setCurrentPage(1);
  }, []);

  const filteredUsers = useMemo(() => {
    let result = users;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (u) =>
          u.name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.role?.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      let aVal = '';
      let bVal = '';
      if (sortField === 'name') {
        aVal = (a.name || a.email || '').toLowerCase();
        bVal = (b.name || b.email || '').toLowerCase();
      } else if (sortField === 'createdAt') {
        aVal = a.createdAt ?? '';
        bVal = b.createdAt ?? '';
      } else if (sortField === 'role') {
        aVal = (a.role ?? '').toLowerCase();
        bVal = (b.role ?? '').toLowerCase();
      }
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [users, searchQuery, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const authApiBase = `${apiBaseUrl}/plugins/auth`;

  // ── Check API Key Feature ───────────────────────────────────

  const checkApiKeys = useCallback(async () => {
    try {
      const res = await fetch(`${authApiBase}/info`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setApiKeysEnabled(!!data.apiKeysEnabled);
      }
    } catch {
      // Silently ignore — feature just won't show
    } finally {
      setHasCheckedApiKeys(true);
    }
  }, [authApiBase]);

  // ── Fetch Users ────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${authApiBase}/users`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to fetch users' }));
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUsers(data.users ?? []);
      setHasFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  }, [authApiBase]);

  // ── Delete User ────────────────────────────────────────────

  const deleteUser = useCallback(
    async (userId: string) => {
      try {
        const res = await fetch(`${authApiBase}/users/${userId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setPendingDeleteUser(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete user');
        setPendingDeleteUser(null);
      }
    },
    [authApiBase],
  );

  // ── Update Role ────────────────────────────────────────────

  const updateRole = useCallback(
    async (userId: string, role: string) => {
      try {
        const res = await fetch(`${authApiBase}/users/${userId}/role`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update role');
      }
    },
    [authApiBase],
  );

  // Guard: only admins see this
  if (!isAuthenticated || user?.role !== 'admin') {
    return null;
  }

  // Auto-fetch on first render
  if (!hasFetched && !isLoading) {
    fetchUsers();
  }
  if (!hasCheckedApiKeys) {
    checkApiKeys();
  }

  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {/* Search + Create User */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none text-imp-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search users…"
            className="w-full py-2 pr-3 text-sm border rounded-lg outline-none border-imp-border bg-transparent pl-9 placeholder:text-imp-muted-foreground focus:border-imp-primary/50"
          />
        </div>
        {apiKeysEnabled && (
          <button
            type="button"
            onClick={() => setShowApiKeysDialog(true)}
            className="flex items-center gap-1.5 rounded-lg border border-imp-border px-3 py-2 text-sm font-medium text-imp-muted-foreground transition-colors hover:border-imp-primary/50 hover:text-imp-foreground"
          >
            <Key className="w-4 h-4" /> API Keys
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-1.5 rounded-lg border border-imp-border px-3 py-2 text-sm font-medium text-imp-muted-foreground transition-colors hover:border-imp-primary/50 hover:text-imp-foreground"
        >
          <UserPlus className="w-4 h-4" /> Create User
        </button>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 rounded-md bg-red-50 dark:bg-red-950/20 dark:text-red-400">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-hidden border rounded-xl border-imp-border bg-imp-background/40">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr className="text-xs font-medium border-b border-imp-border bg-imp-muted/20 text-imp-muted-foreground">
              <SortHeader
                label="User"
                field="name"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Global Role"
                field="role"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortHeader
                label="Created"
                field="createdAt"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                align="right"
              />
              <th className="px-4 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-imp-border">
            {paginatedUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-sm text-center text-imp-muted-foreground">
                  {!hasFetched || isLoading
                    ? 'Loading…'
                    : searchQuery
                      ? 'No users match your search.'
                      : 'No users found.'}
                </td>
              </tr>
            )}
            {paginatedUsers.map((u) => (
              <tr key={u.id} className="group hover:bg-imp-muted/20">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 text-xs font-semibold rounded-full shrink-0 bg-imp-primary/10 text-imp-primary">
                      {getInitials(u)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate text-imp-foreground">
                        {u.name || 'Unnamed'}
                      </div>
                      <div className="text-xs truncate text-imp-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.role === AUTH_ADMIN_ROLE ? (
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-sm font-medium ${ROLE_BADGE_CLASSES}`}
                    >
                      {formatAuthRoleLabel(u.role)}
                    </span>
                  ) : (
                    <RoleDropdown
                      value={u.role ?? AUTH_DEFAULT_ROLE}
                      userId={u.id}
                      disabled={u.id === user?.id}
                      onChange={updateRole}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-right text-imp-muted-foreground">
                  {u.createdAt ? formatDate(u.createdAt) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.role === AUTH_ADMIN_ROLE ? (
                    <span className="text-xs text-imp-muted-foreground">Config managed</span>
                  ) : u.id !== user?.id ? (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteUser(u)}
                      className="rounded-md p-1.5 text-imp-muted-foreground opacity-0 transition-opacity hover:bg-imp-destructive/10 hover:text-imp-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-xs text-imp-muted-foreground">
          {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="rounded-md border border-imp-border px-2.5 py-1 text-xs hover:bg-imp-muted disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-imp-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="rounded-md border border-imp-border px-2.5 py-1 text-xs hover:bg-imp-muted disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* API Keys Dialog */}
      {apiKeysEnabled && (
        <ApiKeysDialog
          open={showApiKeysDialog}
          onOpenChange={setShowApiKeysDialog}
          apiBaseUrl={apiBaseUrl}
        />
      )}

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => !open && setShowCreateDialog(false)}>
        <DialogContent className="max-w-md border-imp-border bg-imp-background text-imp-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Create New User</DialogTitle>
          </DialogHeader>
          <CreateUserForm
            apiBaseUrl={authApiBase}
            onCreated={(newUser) => {
              setUsers((prev) => [...prev, newUser]);
              setShowCreateDialog(false);
            }}
            onCancel={() => setShowCreateDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={pendingDeleteUser !== null}
        onOpenChange={(open) => !open && setPendingDeleteUser(null)}
      >
        <DialogContent className="max-w-sm border-imp-border bg-imp-background text-imp-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Delete user</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-imp-muted-foreground">
            Are you sure you want to delete{' '}
            <span className="font-medium text-imp-foreground">
              {pendingDeleteUser?.name || pendingDeleteUser?.email || 'this user'}
            </span>
            ? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setPendingDeleteUser(null)}
              className="rounded-md border border-imp-border px-3 py-1.5 text-sm hover:bg-imp-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => pendingDeleteUser && deleteUser(pendingDeleteUser.id)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal: Create User Form
// ─────────────────────────────────────────────────────────────

function CreateUserForm({
  apiBaseUrl,
  onCreated,
  onCancel,
}: {
  apiBaseUrl: string;
  onCreated: (user: ManagedUser) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(AUTH_DEFAULT_ROLE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: name.trim() || undefined, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      onCreated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block mb-1 text-xs font-medium text-imp-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="User name"
            className="w-full rounded-md border border-imp-border bg-imp-background px-3 py-1.5 text-sm placeholder:text-imp-muted-foreground focus:outline-none focus:border-imp-primary/50"
          />
        </div>
        <div>
          <label className="block mb-1 text-xs font-medium text-imp-foreground">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-md border border-imp-border bg-imp-background px-3 py-1.5 text-sm focus:outline-none focus:border-imp-primary/50"
          >
            {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-imp-muted-foreground">
            Flow access can still be granted via RBAC.
          </p>
        </div>
      </div>

      <div>
        <label className="block mb-1 text-xs font-medium text-imp-foreground">
          Email <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          required
          autoComplete="off"
          className="w-full rounded-md border border-imp-border bg-imp-background px-3 py-1.5 text-sm placeholder:text-imp-muted-foreground focus:outline-none focus:border-imp-primary/50"
        />
      </div>

      <div>
        <label className="block mb-1 text-xs font-medium text-imp-foreground">
          Password <span className="text-red-500">*</span>
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-md border border-imp-border bg-imp-background px-3 py-1.5 text-sm placeholder:text-imp-muted-foreground focus:outline-none focus:border-imp-primary/50"
        />
      </div>

      {error && (
        <div className="p-2 text-xs text-red-600 rounded-md bg-red-50 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-imp-border px-3 py-1.5 text-sm hover:bg-imp-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-semibold rounded-md bg-imp-primary text-imp-primary-foreground hover:bg-imp-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </form>
  );
}
