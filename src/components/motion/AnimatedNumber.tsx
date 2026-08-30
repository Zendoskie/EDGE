import { animate, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  duration?: number;
};

export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
  duration = 0.7,
}: Props) {
  const reduceMotion = useReducedMotion();
  const previousValue = useRef(0);
  const [displayValue, setDisplayValue] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      previousValue.current = value;
      setDisplayValue(value);
      return;
    }

    const controls = animate(previousValue.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplayValue,
    });
    previousValue.current = value;
    return () => controls.stop();
  }, [duration, reduceMotion, value]);

  const formatted = `${prefix}${displayValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;

  return (
    <motion.span
      className={cn('tabular-nums', className)}
      aria-label={`${prefix}${value.toFixed(decimals)}${suffix}`}
      initial={reduceMotion ? false : { opacity: 0.55, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.3 }}
    >
      {formatted}
    </motion.span>
  );
}
