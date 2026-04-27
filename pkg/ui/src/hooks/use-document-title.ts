import { useEffect } from 'react';

export function useDocumentTitle(page: string) {
  useEffect(() => {
    const capitalized = page.charAt(0).toUpperCase() + page.slice(1);
    document.title = `flowlib | ${capitalized}`;
  }, [page]);
}
