import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Brain, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type CanonicalRiskLevel = "critical" | "at_risk" | "stable" | "excelling";
type ChatMsg = { role: "user" | "assistant"; content: string };
type AICoachResponse = { reply?: string; risk_level?: string; subject?: { code?: string | null; name?: string | null } | null };

function canonicalRiskLevel(level: unknown): CanonicalRiskLevel {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  if (normalized === "stable") return "stable";
  return "stable";
}

function riskLabel(level: CanonicalRiskLevel) {
  if (level === "critical") return "Critical";
  if (level === "at_risk") return "At Risk";
  if (level === "excelling") return "Excelling";
  return "Stable";
}

function riskVariant(level: CanonicalRiskLevel): "destructive" | "default" | "secondary" {
  if (level === "critical" || level === "at_risk") return "destructive";
  if (level === "excelling") return "default";
  return "secondary";
}

const defaultStarter: ChatMsg[] = [
  {
    role: "assistant",
    content:
      "Hi—I'm here to help you get back on track. What’s the biggest challenge right now: attendance, missing work, or understanding the lessons?",
  },
];

export function AICoachPopup(props: {
  riskLevel?: string | null;
  recommendation?: string | null;
  subjectLabel?: string | null;
  storageKey?: string;
  variant?: "compact" | "detailed";
}) {
  const canonical = canonicalRiskLevel(props.riskLevel);
  const shouldShow = canonical === "critical" || canonical === "at_risk";
  const storageKey = props.storageKey || "edge_ai_coach_dismissed_v1";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(defaultStarter);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const contextHint = useMemo(() => {
    const bits: string[] = [];
    if (props.subjectLabel) bits.push(`Subject: ${props.subjectLabel}`);
    if (props.recommendation) bits.push(`Recommendation: ${props.recommendation}`);
    return bits.join("\n");
  }, [props.subjectLabel, props.recommendation]);

  useEffect(() => {
    if (!shouldShow) return;
    const dismissed = localStorage.getItem(storageKey);
    if (dismissed) return;
    // Auto-open once for at-risk students
    setOpen(true);
  }, [shouldShow, storageKey]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [open, messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const payloadMessages: ChatMsg[] = [
        ...messages,
        { role: "user", content: text },
        ...(props.variant === "detailed" && contextHint
          ? [{ role: "user" as const, content: `Context (do not quote verbatim):\n${contextHint}` }]
          : []),
      ];

      const { data, error } = await supabase.functions.invoke<AICoachResponse>("ai-coach", {
        body: { messages: payloadMessages },
      });
      if (error) throw new Error(error.message || "Failed to reach AI coach");
      const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
      if (!reply) throw new Error("AI coach returned an empty response");
      return reply;
    },
    onSuccess: (reply, text) => {
      setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: reply }]);
    },
    onError: (e) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn’t respond right now (network or configuration issue). Try again in a moment, or ask your instructor for help directly.",
        },
      ]);
      console.error(e);
    },
  });

  if (!shouldShow) return null;

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40">
        <Button
          className={cn(
            "rounded-full shadow-lg gap-2",
            canonical === "critical" ? "bg-destructive hover:bg-destructive/90" : "",
          )}
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-4 w-4" />
          AI Coach
          <Badge variant={riskVariant(canonical)} className="ml-1">
            {riskLabel(canonical)}
          </Badge>
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) localStorage.setItem(storageKey, "1");
        }}
      >
        <DialogContent className="p-0 overflow-hidden">
          <div className="p-6 pb-4 border-b">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Coach
                <Badge variant={riskVariant(canonical)}>{riskLabel(canonical)}</Badge>
              </DialogTitle>
              <DialogDescription>
                {canonical === "critical"
                  ? "Let’s make a simple plan for the next 24–48 hours."
                  : "Let’s make a simple plan for the next 7 days."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 pt-4">
            {props.variant === "detailed" && (props.subjectLabel || props.recommendation) ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground mb-3">
                {props.subjectLabel ? <div className="mb-1"><span className="font-medium text-foreground">Subject:</span> {props.subjectLabel}</div> : null}
                {props.recommendation ? <div><span className="font-medium text-foreground">Latest recommendation:</span> {props.recommendation}</div> : null}
              </div>
            ) : null}
          </div>

          <ScrollArea className="h-[320px] px-6">
            <div className="space-y-3 pb-4">
              {messages.map((m, idx) => (
                <div key={idx} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground border",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          </ScrollArea>

          <div className="p-4 border-t bg-background">
            <div className="flex gap-2 items-end">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message…"
                className="min-h-[44px] max-h-[120px]"
                disabled={sendMutation.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const text = draft.trim();
                    if (!text || sendMutation.isPending) return;
                    setDraft("");
                    sendMutation.mutate(text);
                  }
                }}
              />
              <Button
                size="icon"
                disabled={sendMutation.isPending || !draft.trim()}
                onClick={() => {
                  const text = draft.trim();
                  if (!text || sendMutation.isPending) return;
                  setDraft("");
                  sendMutation.mutate(text);
                }}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Tip: Press Enter to send, Shift+Enter for a new line.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

