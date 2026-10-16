import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared motion for the app. Durations and easing come from one place, and everything
 * here is switched off when the device asks for reduced motion (MotionConfig in main.tsx,
 * plus the reduced-motion rule in styles.css for CSS animations).
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Each page fades and rises in when the route changes. */
export function PageTransition({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}

/**
 * Class + delay for a staggered entrance (cards, tiles, icons appearing one after another).
 * CSS-only (tw-animate-css), so it costs nothing after the first paint.
 */
export const enter = 'animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out fill-mode-both';
export const stagger = (i: number, step = 45): CSSProperties => ({ animationDelay: `${i * step}ms` });
