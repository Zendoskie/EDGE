import { cn } from "@/lib/utils";

type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<StatusTone, string> = {
  success: "bg-[#DDF6EE] text-[#0F8F6A]",
  warning: "bg-[#FFF4DE] text-[#B7791F]",
  danger: "bg-[#FDE7ED] text-[#D8375F]",
  info: "bg-[#E7E9FF] text-[#4555E0]",
  neutral: "bg-muted text-muted-foreground",
};

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: string;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
