import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, sendParentLinkEmailBestEffort } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendParentLinkEmailBestEffort: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc },
}));

vi.mock('@/lib/invoke-parent-email', () => ({
  sendParentLinkEmailBestEffort,
}));

import { adminReviewParentRequest } from '@/lib/parent-link-actions';

describe('adminReviewParentRequest', () => {
  beforeEach(() => {
    rpc.mockReset();
    sendParentLinkEmailBestEffort.mockReset();
  });

  it('emails the parent when an admin rejects a registration request', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await adminReviewParentRequest('req-1', 'reject');

    expect(rpc).toHaveBeenCalledWith('admin_review_parent_request', {
      p_request_id: 'req-1',
      p_decision: 'reject',
    });
    expect(sendParentLinkEmailBestEffort).toHaveBeenCalledWith({
      type: 'admin_rejected',
      registration_request_id: 'req-1',
    });
  });
});
