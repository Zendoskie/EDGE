import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sanitizeAssistantPlainText } from "@/lib/format-assistant-text";

function renderBlockLines(block: string, baseKey: string): ReactNode[] {
  const lines = block.split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmedStart = lines[i].trimStart();
    if (trimmedStart.startsWith("•")) {
      const items: string[] = [];
      while (i < lines.length) {
        const ts = lines[i].trimStart();
        if (!ts.startsWith("•")) break;
        items.push(ts.replace(/^•\s*/, ""));
        i++;
      }
      out.push(
        <ul key={`${baseKey}-ul-${i}`} className="list-none space-y-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-3">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/80"
                aria-hidden
              />
              <span className="min-w-0 flex-1">{item}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(trimmedStart)) {
      const items: string[] = [];
      while (i < lines.length) {
        const ts = lines[i].trimStart();
        const m = ts.match(/^(\d+)\.\s+(.*)$/);
        if (!m) break;
        items.push(m[2]);
        i++;
      }
      out.push(
        <ol
          key={`${baseKey}-ol-${i}`}
          className="list-decimal space-y-2 pl-5 [list-style-position:outside] marker:font-medium marker:text-foreground/85"
        >
          {items.map((item, j) => (
            <li key={j} className="pl-1.5">
              {item}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const chunk: string[] = [];
    while (i < lines.length) {
      const ts = lines[i].trimStart();
      if (ts.startsWith("•")) break;
      if (/^\d+\.\s/.test(ts)) break;
      chunk.push(lines[i]);
      i++;
    }
    const text = chunk.join("\n").trim();
    if (text) {
      out.push(
        <p
          key={`${baseKey}-p-${i}`}
          className="whitespace-pre-line text-pretty [&:not(:last-child)]:mb-1"
        >
          {text}
        </p>,
      );
    }
  }

  return out;
}

type FormattedAssistantContentProps = {
  text: string;
  className?: string;
};

export function FormattedAssistantContent({ text, className }: FormattedAssistantContentProps) {
  const clean = sanitizeAssistantPlainText(text);
  if (!clean) return null;

  const blocks = clean
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className={cn("text-sm leading-7 text-foreground space-y-4 break-words", className)}>
      {blocks.map((block, idx) => (
        <div key={idx} className="space-y-2">
          {renderBlockLines(block, `blk-${idx}`)}
        </div>
      ))}
    </div>
  );
}
