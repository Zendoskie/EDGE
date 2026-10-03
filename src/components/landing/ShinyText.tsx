import { motion } from "framer-motion";
import type { ReactNode } from "react";

/** Animated left-to-right shine on text; gradient 100deg, ~3s loop (DesignPro-style). */
export function ShinyText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(100deg, #64CEFB 0%, #64CEFB 32%, #ffffff 50%, #64CEFB 68%, #64CEFB 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      }}
      initial={false}
      animate={{ backgroundPosition: ["0% 50%", "200% 50%"] }}
      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
    >
      {children}
    </motion.span>
  );
}
