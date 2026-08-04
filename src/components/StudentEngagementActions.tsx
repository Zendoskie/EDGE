import { useState } from 'react';
import { toast } from 'sonner';
import { Bell, History, NotebookPen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useEngagementInterventions,
  useLogEngagementIntervention,
  useStudentEngagementAlerts,
} from '@/hooks/useEngagementAlerts';
import {
  engagementAlertTypeLabel,
  engagementInterventionActionLabel,
  type EngagementInterventionAction,
} from '@/lib/engagement-alerts';
import { formatLastLogin } from '@/lib/engagement-format';

type Props = {
  studentId: string;
  studentEmail?: string | null;
  subjectId?: string | null;
};

const ACTIONS: { type: EngagementInterventionAction; label: string; needsEmail?: boolean }[] = [
  { type: 'send_reminder', label: 'Send Reminder' },
  { type: 'send_email_reminder', label: 'Send Email Reminder', needsEmail: true },
  { type: 'schedule_consultation', label: 'Schedule Consultation' },
  { type: 'add_note', label: 'Add Engagement Note' },
  { type: 'mark_contacted', label: 'Mark Student as Contacted' },
];

export function StudentEngagementActions({ studentId, studentEmail, subjectId }: Props) {
  const { data: alerts = [], isLoading: alertsLoading } = useStudentEngagementAlerts(studentId);
  const { data: interventions = [], isLoading: historyLoading } = useEngagementInterventions(studentId);
  const logIntervention = useLogEngagementIntervention();
  const [note, setNote] = useState('');
  const [selectedAlertId, setSelectedAlertId] = useState<string>('none');

  const openAlerts = alerts.filter((a) => a.status === 'open');

  const runAction = async (actionType: EngagementInterventionAction, needsEmail?: boolean) => {
    try {
      await logIntervention.mutateAsync({
        studentId,
        actionType,
        note,
        alertId: selectedAlertId !== 'none' ? selectedAlertId : openAlerts[0]?.id ?? null,
        sendEmail: Boolean(needsEmail),
        studentEmail,
        subjectId,
      });
      toast.success(`${engagementInterventionActionLabel(actionType)} logged`);
      setNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to log action');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Bell className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Engagement Alerts</p>
        </div>
        {alertsLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : openAlerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open engagement alerts for this student.</p>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {openAlerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border border-border/60 p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{engagementAlertTypeLabel(alert.alert_type)}</Badge>
                  <span className="text-xs text-muted-foreground">{formatLastLogin(alert.created_at)}</span>
                </div>
                <p className="text-sm font-medium">{alert.title}</p>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Instructor Actions</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="engagement-action-note">Note (optional)</Label>
          <Textarea
            id="engagement-action-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a short message or consultation details…"
            className="min-h-[72px]"
          />
        </div>
        {openAlerts.length > 0 ? (
          <div className="space-y-2">
            <Label>Link to alert</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedAlertId}
              onChange={(e) => setSelectedAlertId(e.target.value)}
            >
              <option value="none">Latest open alert (default)</option>
              {openAlerts.map((alert) => (
                <option key={alert.id} value={alert.id}>
                  {engagementAlertTypeLabel(alert.alert_type)} — {alert.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((action) => (
            <Button
              key={action.type}
              type="button"
              size="sm"
              variant={action.type === 'mark_contacted' ? 'default' : 'outline'}
              disabled={logIntervention.isPending || (action.needsEmail && !studentEmail)}
              onClick={() => void runAction(action.type, action.needsEmail)}
            >
              {action.label}
            </Button>
          ))}
        </div>
        {ACTIONS.some((a) => a.needsEmail) && !studentEmail ? (
          <p className="text-xs text-muted-foreground">Email reminder unavailable — student email not found.</p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <History className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Intervention History</p>
        </div>
        {historyLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No engagement interventions logged yet.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {interventions.map((item) => (
              <div key={item.id} className="rounded-lg border border-border/60 p-3 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">{engagementInterventionActionLabel(item.action_type)}</Badge>
                  <span className="text-xs text-muted-foreground">{formatLastLogin(item.created_at)}</span>
                </div>
                {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact alert list for the monitoring page. */
export function EngagementAlertsQueue({
  alerts,
  studentNames,
  onOpenStudent,
  isLoading,
}: {
  alerts: import('@/lib/engagement-alerts').EngagementAlert[];
  studentNames: Map<string, string>;
  onOpenStudent: (studentId: string, fullName: string) => void;
  isLoading?: boolean;
}) {
  const open = alerts.filter((a) => a.status === 'open').slice(0, 12);

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Open Engagement Alerts</p>
        </div>
        <Badge variant="outline">{open.length}</Badge>
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : open.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open alerts right now.</p>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {open.map((alert) => {
            const name = studentNames.get(alert.student_id) || 'Student';
            return (
              <button
                key={alert.id}
                type="button"
                className="w-full text-left rounded-lg border border-border/50 p-3 hover:bg-muted/40 transition-colors"
                onClick={() => onOpenStudent(alert.student_id, name)}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{name}</span>
                  <Badge variant="outline">{engagementAlertTypeLabel(alert.alert_type)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{alert.message}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
