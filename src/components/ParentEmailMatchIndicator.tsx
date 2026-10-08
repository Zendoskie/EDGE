import { parentEmailMatchMessage, parentEmailsMatch } from "@/lib/parent-email-match";

export function ParentEmailMatchIndicator({
  registeredEmail,
  requestEmail,
}: {
  registeredEmail: string | null | undefined;
  requestEmail: string | null | undefined;
}) {
  const matches = parentEmailsMatch(registeredEmail, requestEmail);
  return (
    <p className={matches ? "text-sm font-medium text-success" : "text-sm font-medium text-destructive"} role="status">
      {parentEmailMatchMessage(matches)}
    </p>
  );
}
