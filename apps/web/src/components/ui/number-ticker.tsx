import { useEffect, useRef } from "react";
import { animate, useMotionValue, useReducedMotion, useTransform, motion, type ValueAnimationTransition } from "motion/react";

import { cn } from "@/lib/utils";

/* Number Ticker, from 21st.dev (@danielpetho/basic-number-ticker).

   Local changes for SaaSERP:
     · `format` turns the tweened number into the shown text (money, %, "60.8k"), so the
       app's number formats and Arabic digits are kept
     · re-animates from the current value whenever `value` changes (year / filter switch)
     · jumps straight to the value when the user asks for reduced motion
     · the final text is what screen readers get; the moving digits are hidden from them */

interface NumberTickerProps {
  /** The number to show. null / undefined shows a dash. */
  value: number | null | undefined;
  /** Turns a number into display text. Default: rounded with thousands separators. */
  format?: (v: number) => string;
  /** Where the first count starts. */
  from?: number;
  transition?: ValueAnimationTransition;
  className?: string;
}

const DEFAULT_TRANSITION: ValueAnimationTransition = { duration: 1.1, ease: [0.16, 1, 0.3, 1] };

export function NumberTicker({ value, format = (v) => Math.round(v).toLocaleString(), from = 0, transition, className }: NumberTickerProps) {
  const reduce = useReducedMotion();
  const target = Number(value ?? 0);
  const count = useMotionValue(reduce ? target : from);
  const shown = useTransform(count, (v) => format(v));
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    if (reduce) { count.set(target); return; }
    const controls = animate(count, target, { ...DEFAULT_TRANSITION, ...transition });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce]);

  if (value === null || value === undefined || Number.isNaN(target)) return <span className={className}>—</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      <motion.span aria-hidden>{shown}</motion.span>
      <span className="sr-only">{formatRef.current(target)}</span>
    </span>
  );
}

export default NumberTicker;
