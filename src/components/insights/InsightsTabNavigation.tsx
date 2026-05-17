import { BarChart3, Activity, Brain, MessageSquare, type LucideIcon } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const INSIGHTS_TAB_VALUES = ['overview', 'analytics', 'predictions', 'interventions'] as const;
export type InsightsTabValue = (typeof INSIGHTS_TAB_VALUES)[number];

const TAB_ITEMS: { value: InsightsTabValue; label: string; icon: LucideIcon }[] = [
  { value: 'overview', label: 'Overview', icon: BarChart3 },
  { value: 'analytics', label: 'Analytics', icon: Activity },
  { value: 'predictions', label: 'Predictions', icon: Brain },
  { value: 'interventions', label: 'Interventions', icon: MessageSquare },
];

/** Mobile-only section picker (use with controlled Tabs). */
export function InsightsTabMobileSelect({
  value,
  onValueChange,
}: {
  value: InsightsTabValue;
  onValueChange: (value: InsightsTabValue) => void;
}) {
  return (
    <div className="mb-4 sm:hidden">
      <label htmlFor="insights-tab-select" className="sr-only">
        Insights section
      </label>
      <Select value={value} onValueChange={(v) => onValueChange(v as InsightsTabValue)}>
        <SelectTrigger id="insights-tab-select" className="h-11 w-full bg-card/90">
          <SelectValue placeholder="Choose section" />
        </SelectTrigger>
        <SelectContent>
          {TAB_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <SelectItem key={item.value} value={item.value}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Desktop / tablet tab bar (hidden on phones). */
export function InsightsDesktopTabsList() {
  return (
    <TabsList className="hidden h-12 w-full grid-cols-4 sm:grid">
      {TAB_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="flex items-center justify-center gap-2 text-sm"
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/** Applied to each TabsContent panel — zooms out on mobile so charts/text fit. */
export const INSIGHTS_TAB_PANEL_CLASS = 'mt-4 min-w-0 insights-tab-panel sm:mt-6';
