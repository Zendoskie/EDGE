import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Brain, History, Send, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { canonicalRiskLevel, riskLabel, riskVariant, type CanonicalRiskLevel } from "@/lib/risk-utils";
import { invokeAiCoach } from "@/lib/invoke-ai-coach";
import { FormattedAssistantContent } from "@/components/FormattedAssistantContent";
import { AI_COACH_MODEL_LABEL } from "@/lib/ai-model";

type ChatMsg = { role: "user" | "assistant"; content: string; ts?: number };
type AICoachResponse = {
  reply?: string;
  risk_level?: string;
  subject?: { code?: string | null; name?: string | null } | null;
  error?: string;
};

/** Legacy UI opener — drop stored chats that only contain this so we can show contextual copy. */
const LEGACY_STARTER_SNIPPET = "biggest challenge right now";

function buildContextualStarter(
  canonical: CanonicalRiskLevel,
  recommendation?: string | null,
  subjectLabel?: string | null,
): ChatMsg[] {
  const status = riskLabel(canonical);
  const rec = recommendation?.trim();
  const subj = subjectLabel?.trim();

  let content: string;
  if (rec && subj) {
    content = [
      `Hi—I've already reviewed your latest assessment. You're marked ${status} for ${subj}.`,
      `Here's what your record flags:`,
      "",
      rec,
      "",
      "I'll use that as our focus—you don't need to explain the problem from scratch. Ask a question, or tell me when you want a concrete first step.",
    ].join("\n");
  } else if (rec) {
    content = [
      `Hi—I've reviewed your latest assessment (${status}). Your record indicates:`,
      "",
      rec,
      "",
      "We can work from that directly. Ask anything, or say when you're ready for a simple plan.",
    ].join("\n");
  } else if (subj) {
    content = `Hi—I've reviewed your record: you're ${status} in ${subj}. I'm here to help with specific next steps based on what your instructors already see. What would you like to tackle first?`;
  } else {
    content = `Hi—I've reviewed your academic record: your current status is ${status}. I'm here to help with concrete next steps—you don't need to re-explain everything from scratch. What would help most right now?`;
  }

  return [{ role: "assistant", content, ts: Date.now() }];
}

function messagesStorageKey(dismissKey: string) {
  return `edge_ai_coach_msgs_${dismissKey}`;
}

function parseStoredMessages(raw: string | null): ChatMsg[] | null {
  if (raw == null || raw === "") return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return null;
    const out: ChatMsg[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.role !== "user" && o.role !== "assistant") continue;
      if (typeof o.content !== "string") continue;
      out.push({
        role: o.role,
        content: o.content,
        ts: typeof o.ts === "number" ? o.ts : undefined,
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function readStoredMessages(dismissKey: string): ChatMsg[] | null {
  if (typeof window === "undefined") return null;
  const saved = parseStoredMessages(localStorage.getItem(messagesStorageKey(dismissKey)));
  if (!saved?.length) return null;
  if (
    saved.length === 1 &&
    saved[0].role === "assistant" &&
    saved[0].content.includes(LEGACY_STARTER_SNIPPET)
  ) {
    try {
      localStorage.removeItem(messagesStorageKey(dismissKey));
    } catch {
      /* ignore */
    }
    return null;
  }
  return saved;
}

export function AICoachPopup(props: {
  riskLevel?: string | null;
  recommendation?: string | null;
  subjectLabel?: string | null;
  atRiskSubjects?: string[];
  storageKey?: string;
  variant?: "compact" | "detailed";
}) {
  const canonical = canonicalRiskLevel(props.riskLevel);
  const shouldAutoOpen = canonical === "critical" || canonical === "at_risk";
  const storageKey = props.storageKey || "edge_ai_coach_dismissed_v1";
  const persistKey = messagesStorageKey(storageKey);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const [headerSlotEl, setHeaderSlotEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Portal the AI Coach trigger into the dashboard header (so it doesn't overlap cards/content).
    const el = typeof window !== "undefined" ? document.getElementById("ai-coach-header-slot") : null;
    setHeaderSlotEl(el);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify(messages));
    } catch {
      /* quota */
    }
  }, [messages, persistKey]);

  const contextHint = useMemo(() => {
    const bits: string[] = [];
    bits.push(`Risk level: ${riskLabel(canonical)}`);
    if (props.subjectLabel) bits.push(`Subject: ${props.subjectLabel}`);
    if (props.atRiskSubjects?.length) bits.push(`At-risk subjects: ${props.atRiskSubjects.join(", ")}`);
    if (props.recommendation) bits.push(`Recommendation: ${props.recommendation}`);
    return bits.join("\n");
  }, [canonical, props.subjectLabel, props.atRiskSubjects, props.recommendation]);

  useEffect(() => {
    const saved = readStoredMessages(storageKey);
    const nextStarter = buildContextualStarter(canonical, props.recommendation, props.subjectLabel);

    if (saved?.some((m) => m.role === "user")) {
      setMessages(saved);
      return;
    }
    if (saved && saved.length > 1) {
      setMessages(saved);
      return;
    }

    setMessages((prev) => {
      if (prev.some((m) => m.role === "user")) return prev;
      if (prev.length > 1) return prev;
      return nextStarter;
    });
  }, [storageKey, canonical, props.recommendation, props.subjectLabel]);

  useEffect(() => {
    // Auto-open only for critical/at-risk students.
    if (!shouldAutoOpen) return;
    const dismissed = localStorage.getItem(storageKey);
    if (dismissed) return;
    setOpen(true);
  }, [shouldAutoOpen, storageKey]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [open, messages.length]);

  const toApiMessages = (list: ChatMsg[]) => list.map((m) => ({ role: m.role, content: m.content }));

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const payloadMessages: { role: "user" | "assistant"; content: string }[] = [
        ...toApiMessages(messages),
        { role: "user", content: text },
        ...(contextHint
          ? [{ role: "user" as const, content: `Context (do not quote verbatim):\n${contextHint}` }]
          : []),
      ];

      const data = (await invokeAiCoach({ messages: payloadMessages })) as AICoachResponse;
      if (data?.error) throw new Error(data.error);
      const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
      if (!reply) throw new Error("AI coach returned an empty response");
      return reply;
    },
    onMutate: (text: string) => {
      setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    },
    onSuccess: (reply) => {
      setMessages((prev) => [...prev, { role: "assistant", content: reply, ts: Date.now() }]);
    },
    onError: (error: Error) => {
      setMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].role === "user") {
          next.pop();
        }
        next.push({
          role: "assistant",
          content: `Could not get a reply: ${error.message}`,
          ts: Date.now(),
        });
        return next;
      });
      console.error(error);
    },
  });

  const assistantAdvice = useMemo(
    () =>
      [...messages]
        .map((m, idx) => ({ ...m, idx }))
        .filter((m) => m.role === "assistant")
        .reverse(),
    [messages],
  );

  const resetChat = () => {
    const fresh = buildContextualStarter(canonical, props.recommendation, props.subjectLabel);
    setMessages(fresh);
    try {
      localStorage.removeItem(persistKey);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {headerSlotEl
        ? createPortal(
            <Button
              type="button"
              size="icon"
              variant="outline"
              title="AI Coach"
              aria-label="AI Coach"
              className={cn(
                "h-9 w-9 rounded-lg shrink-0 border-border/80 bg-background/80",
                canonical === "critical" && "border-destructive/70 bg-destructive/10 text-destructive-foreground hover:bg-destructive/20",
                canonical === "at_risk" && "border-destructive/50 bg-destructive/10 text-destructive-foreground hover:bg-destructive/20",
              )}
              onClick={() => setOpen(true)}
            >
              <Sparkles className="h-4 w-4" />
            </Button>,
            headerSlotEl,
          )
        : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) localStorage.setItem(storageKey, "1");
        }}
      >
        <DialogContent className="gap-0 p-0 overflow-hidden max-h-[90vh] flex flex-col min-h-0">
          <div className="p-6 pb-4 border-b shrink-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Coach
                {shouldAutoOpen ? <Badge variant={riskVariant(canonical)}>{riskLabel(canonical)}</Badge> : null}
              </DialogTitle>
              <DialogDescription className="space-y-1">
                <span className="block">
                  {canonical === "critical"
                    ? "Let’s make a simple plan for the next 24–48 hours."
                    : "Let’s make a simple plan for the next 7 days."}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Model: <span className="font-medium text-foreground">{AI_COACH_MODEL_LABEL}</span>
                </span>
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="w-full space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="gap-2">
                      <History className="h-4 w-4" />
                      Advice history
                      {assistantAdvice.length > 0 && (
                        <Badge variant="secondary" className="ml-1 font-normal">
                          {assistantAdvice.length}
                        </Badge>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={resetChat}>
                    Reset chat
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="rounded-lg border bg-muted/25 p-3 max-h-52 overflow-y-auto space-y-3">
                    {assistantAdvice.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No assistant messages yet.</p>
                    ) : (
                      assistantAdvice.map((m) => (
                        <div
                          key={`${m.idx}-${m.ts ?? m.content.slice(0, 20)}`}
                          className="rounded-md border border-border/60 bg-background/80 p-3 text-sm"
                        >
                          {m.ts != null && (
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                              {formatDistanceToNow(m.ts, { addSuffix: true })}
                            </p>
                          )}
                          <FormattedAssistantContent text={m.content} className="!text-sm !leading-6" />
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          <div className="px-6 pt-4 shrink-0">
            {props.atRiskSubjects?.length ? (
              <div className="rounded-lg border bg-muted/30 p-3 mb-3">
                <p className="text-xs font-medium text-foreground mb-2">Current at-risk subjects</p>
                <div className="flex flex-wrap gap-2">
                  {props.atRiskSubjects.map((subject) => (
                    <Badge key={subject} variant="outline" className="border-destructive/40 bg-destructive/10 text-foreground">
                      {subject}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {props.variant === "detailed" && (props.subjectLabel || props.recommendation) ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground mb-3">
                {props.subjectLabel ? (
                  <div className="mb-1">
                    <span className="font-medium text-foreground">Subject:</span> {props.subjectLabel}
                  </div>
                ) : null}
                {props.recommendation ? (
                  <div>
                    <span className="font-medium text-foreground">Latest recommendation:</span> {props.recommendation}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 overscroll-contain touch-pan-y"
            role="log"
            aria-label="Chat messages"
          >
            <div className="space-y-4 pb-4 pt-1">
              {messages.map((m, idx) => (
                <div
                  key={`${idx}-${m.ts ?? ""}-${m.content.slice(0, 12)}`}
                  className={cn("flex flex-col gap-1", m.role === "user" ? "items-end" : "items-start")}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
                    {m.role === "user" ? "You" : "Assistant"}
                    {m.ts != null ? (
                      <span className="normal-case font-normal text-muted-foreground/70">
                        {" "}
                        · {formatDistanceToNow(m.ts, { addSuffix: true })}
                      </span>
                    ) : null}
                  </span>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted/80 text-foreground border border-border/80 rounded-bl-md",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <FormattedAssistantContent text={m.content} className="!text-inherit !leading-7" />
                    ) : (
                      <p className="whitespace-pre-wrap leading-7">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          </div>

          <div className="p-4 border-t bg-background shrink-0">
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
            <p className="text-xs text-muted-foreground mt-2">Tip: Press Enter to send, Shift+Enter for a new line.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
