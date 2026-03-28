import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Brain, History, Send, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { canonicalRiskLevel, riskLabel, riskVariant } from "@/lib/risk-utils";
import { invokeAiCoach } from "@/lib/invoke-ai-coach";
import { FormattedAssistantContent } from "@/components/FormattedAssistantContent";

type ChatMsg = { role: "user" | "assistant"; content: string; ts?: number };
type AICoachResponse = {
  reply?: string;
  risk_level?: string;
  subject?: { code?: string | null; name?: string | null } | null;
  error?: string;
};

const defaultStarter: ChatMsg[] = [
  {
    role: "assistant",
    content:
      "Hi—I'm here to help you get back on track. What’s the biggest challenge right now: attendance, missing work, or understanding the lessons?",
  },
];

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

function initialMessages(dismissKey: string): ChatMsg[] {
  if (typeof window === "undefined") {
    return defaultStarter.map((m, i) => ({ ...m, ts: Date.now() - (defaultStarter.length - i) * 1000 }));
  }
  const saved = parseStoredMessages(localStorage.getItem(messagesStorageKey(dismissKey)));
  if (saved) return saved;
  return defaultStarter.map((m, i) => ({ ...m, ts: Date.now() - (defaultStarter.length - i) * 1000 }));
}

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
  const persistKey = messagesStorageKey(storageKey);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(() => initialMessages(storageKey));
  const [historyOpen, setHistoryOpen] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify(messages));
    } catch {
      /* quota */
    }
  }, [messages, persistKey]);

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
    setOpen(true);
  }, [shouldShow, storageKey]);

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
        ...(props.variant === "detailed" && contextHint
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
    const fresh = defaultStarter.map((m, i) => ({ ...m, ts: Date.now() - (defaultStarter.length - i) * 1000 }));
    setMessages(fresh);
    try {
      localStorage.removeItem(persistKey);
    } catch {
      /* ignore */
    }
  };

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
        <DialogContent className="p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <div className="p-6 pb-4 border-b shrink-0">
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

          <ScrollArea className="flex-1 min-h-[200px] max-h-[360px] px-6">
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
          </ScrollArea>

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
