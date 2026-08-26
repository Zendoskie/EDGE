export const INSIGHTS_TAB_VALUES = ['overview', 'analytics', 'predictions', 'interventions'] as const;
export type InsightsTabValue = (typeof INSIGHTS_TAB_VALUES)[number];

/** Applied to each TabsContent panel — zooms out on mobile so charts/text fit. */
export const INSIGHTS_TAB_PANEL_CLASS = 'mt-4 min-w-0 insights-tab-panel sm:mt-6';
