import { useTheme } from '../contexts/ThemeProvider';

/**
 * Returns the class name string for portal wrappers that need to be inside the
 * `.flowlib` CSS scope.
 *
 * Radix portals render to `document.body`, which sits outside the main `.flowlib`
 * container. Without a wrapper, portal content loses access to flowlib's CSS
 * variables and the Tailwind `dark:` variant.
 *
 * Usage:
 * ```tsx
 * const portalClass = useFlowlibPortalClass();
 * return (
 *   <SomePrimitive.Portal>
 *     <div className={portalClass}>
 *       {children}
 *     </div>
 *   </SomePrimitive.Portal>
 * );
 * ```
 */
export function useFlowlibPortalClass(): string {
  const { resolvedTheme } = useTheme();

  return `flowlib ${resolvedTheme}`;
}
