import { useEffect, useState } from 'react';

/**
 * Coordinates mount/visibility for animated panels.
 *
 * - `shouldRender`: keeps the component in the DOM through the exit animation.
 * - `isVisible`: flips on the frame *after* mount so a width/opacity transition
 *   fires from its closed state to its open state. Without this, a node mounted
 *   already at its final width has no starting state to transition from.
 */
export function useDelayedUnmount(isOpen: boolean, durationMs = 200) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setIsVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setIsVisible(false);
    const timer = setTimeout(() => setShouldRender(false), durationMs);
    return () => clearTimeout(timer);
  }, [isOpen, durationMs]);

  return {
    shouldRender,
    isVisible,
    dataState: (isVisible ? 'open' : 'closed') as 'open' | 'closed',
  };
}
