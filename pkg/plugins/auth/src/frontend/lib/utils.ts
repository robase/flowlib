import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || '';
  if (!source) {
    return '?';
  }
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (!first) {
    return source.slice(0, 1).toUpperCase();
  }
  if (!second) {
    return first.slice(0, 2).toUpperCase();
  }
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}
