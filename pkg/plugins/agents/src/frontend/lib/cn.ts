type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v) {
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        walk(item);
      }
      return;
    }
    if (typeof v === 'string' || typeof v === 'number') {
      out.push(String(v));
    }
  };
  for (const v of inputs) {
    walk(v);
  }
  return out.join(' ');
}
