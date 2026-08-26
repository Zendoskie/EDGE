import type { CanonicalEngagementLevel } from '@/lib/engagement-utils';

export type EngagementNextStep = {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
};

/** Gentle, actionable tips for students based on engagement level/score. */
export function buildEngagementNextSteps(
  level: CanonicalEngagementLevel | null | undefined,
  score: number | null | undefined,
): EngagementNextStep[] {
  const tips: EngagementNextStep[] = [];
  const s = score ?? 0;
  const lv = level ?? 'low';

  if (lv === 'low' || s < 40) {
    tips.push({
      title: 'Log in a few times this week',
      body: 'Short, regular visits help more than one long session. Open EDGE at least 2–3 times this week.',
      href: '/dashboard',
      linkLabel: 'Go to dashboard',
    });
    tips.push({
      title: 'Check open assignments',
      body: 'Submitting even one pending activity raises your assignment engagement component.',
      href: '/dashboard/my-subjects',
      linkLabel: 'Open my subjects',
    });
  } else if (lv === 'moderate' || s < 60) {
    tips.push({
      title: 'Finish one assignment today',
      body: 'A single completed submission can move you out of Low Engagement.',
      href: '/dashboard/my-subjects',
      linkLabel: 'Open my subjects',
    });
    tips.push({
      title: 'Spend focused time in a subject',
      body: 'Open a subject page and review materials or discussions for 15–20 minutes.',
      href: '/dashboard/my-subjects',
      linkLabel: 'Browse subjects',
    });
  } else if (lv === 'high') {
    tips.push({
      title: 'Keep your streak going',
      body: 'You are Active — stay consistent with weekly logins and timely submissions.',
      href: '/dashboard/my-subjects',
      linkLabel: 'Check subjects',
    });
    tips.push({
      title: 'Use AI coaching when stuck',
      body: 'Asking the AI coach for study tips counts toward engagement and can clarify next steps.',
    });
  } else {
    tips.push({
      title: 'Share what works',
      body: 'You are Highly Active — keep submitting work on time and participate in discussions when available.',
      href: '/dashboard/my-subjects',
      linkLabel: 'Go to subjects',
    });
  }

  tips.push({
    title: 'Give course feedback',
    body: 'Brief feedback after activities helps instructors support you and contributes to your engagement score.',
  });

  return tips.slice(0, 3);
}
