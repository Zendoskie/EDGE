import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import { sendBulkVulnerableNotifications } from '@/lib/bulk-vulnerable-notification';

const recipients = [
  { to: 'a@example.com', student_id: 's1', subject_id: 'sub-1', risk_level: 'at_risk' },
  { to: 'b@example.com', student_id: 's2', subject_id: 'sub-1', risk_level: 'critical' },
];

describe('sendBulkVulnerableNotifications', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('returns parsed bulk counts on success', async () => {
    invoke.mockResolvedValue({
      data: { success: true, mode: 'bulk', sent: 2, failed: 0, errors: [] },
      error: null,
    });
    const result = await sendBulkVulnerableNotifications({
      subjectCode: 'PL101',
      subjectName: 'Logic',
      body: 'Please check EDGE',
      recipients,
    });
    expect(result).toEqual({
      kind: 'bulk',
      sent: 2,
      failed: 0,
      total: 2,
      errors: [],
    });
  });

  it('returns partial batch counts with errors', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'bulk',
        sent: 1,
        failed: 1,
        errors: [{ index: 1, message: 'Brevo rejected' }],
      },
      error: null,
    });
    const result = await sendBulkVulnerableNotifications({
      subjectCode: 'PL101',
      subjectName: 'Logic',
      body: 'Update',
      recipients,
    });
    expect(result).toMatchObject({ kind: 'bulk', sent: 1, failed: 1, total: 2 });
  });

  it('flags malformed responses', async () => {
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    const result = await sendBulkVulnerableNotifications({
      subjectCode: 'PL101',
      subjectName: 'Logic',
      body: 'Update',
      recipients,
    });
    expect(result).toEqual({ kind: 'invalid_response' });
  });

  it('surfaces invoke transport errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const result = await sendBulkVulnerableNotifications({
      subjectCode: 'PL101',
      subjectName: 'Logic',
      body: 'Update',
      recipients,
    });
    expect(result).toEqual({ kind: 'invoke_error', message: 'offline' });
  });

  it('parses sent:0 failed:0 without treating it as delivered', async () => {
    invoke.mockResolvedValue({
      data: { success: true, mode: 'bulk', sent: 0, failed: 0, errors: [] },
      error: null,
    });
    const result = await sendBulkVulnerableNotifications({
      subjectCode: 'PL101',
      subjectName: 'Logic',
      body: 'Update',
      recipients,
    });
    expect(result).toMatchObject({ kind: 'bulk', sent: 0, failed: 0, total: 2 });
  });
});
