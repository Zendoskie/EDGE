import { describe, expect, it } from 'vitest';
import {
  normalizeEmailForCompare,
  parentRegistrationEmailsMatch,
  validateRegistrationWelcomeEligibility,
  registrationWelcomeDecisionId,
} from '../../supabase/functions/_shared/parent-registration-welcome.ts';

describe('parent registration welcome eligibility', () => {
  const base = {
    invitationRole: 'parent',
    invitationStatus: 'accepted',
    invitationEmail: 'parent@example.com',
    requestStatus: 'approved',
    requestCompletedAt: '2026-10-20T12:00:00.000Z',
    requestEmail: 'parent@example.com',
    linkStatus: 'approved',
    parentProfileEmail: 'Parent@Example.com',
  };

  it('allows welcome email after completed registration', () => {
    expect(validateRegistrationWelcomeEligibility(base)).toEqual({ eligible: true });
  });

  it('rejects non-parent invitation role', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, invitationRole: 'instructor' })).toEqual({
      eligible: false,
      reason: 'invitation_role_not_parent',
    });
  });

  it('rejects invitation that is not accepted', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, invitationStatus: 'pending' })).toEqual({
      eligible: false,
      reason: 'invitation_not_accepted',
    });
    expect(validateRegistrationWelcomeEligibility({ ...base, invitationStatus: 'revoked' })).toEqual({
      eligible: false,
      reason: 'invitation_not_accepted',
    });
  });

  it('rejects registration request that is not approved', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, requestStatus: 'pending_admin' })).toEqual({
      eligible: false,
      reason: 'request_not_approved',
    });
    expect(validateRegistrationWelcomeEligibility({ ...base, requestStatus: 'admin_rejected' })).toEqual({
      eligible: false,
      reason: 'request_not_approved',
    });
  });

  it('rejects before completion timestamp', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, requestCompletedAt: null })).toEqual({
      eligible: false,
      reason: 'registration_not_completed',
    });
  });

  it('rejects email mismatch between invitation and request', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, invitationEmail: 'other@example.com' })).toEqual({
      eligible: false,
      reason: 'invitation_request_email_mismatch',
    });
  });

  it('rejects when link is not approved', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, linkStatus: 'pending_admin' })).toEqual({
      eligible: false,
      reason: 'parent_link_not_approved',
    });
  });

  it('rejects when parent profile email does not match registration identity', () => {
    expect(validateRegistrationWelcomeEligibility({ ...base, parentProfileEmail: 'other@example.com' })).toEqual({
      eligible: false,
      reason: 'parent_profile_email_mismatch',
    });
    expect(validateRegistrationWelcomeEligibility({ ...base, parentProfileEmail: null })).toEqual({
      eligible: false,
      reason: 'parent_profile_not_found',
    });
  });

  it('canonicalizes email casing for identity match', () => {
    expect(parentRegistrationEmailsMatch('Parent@Example.com', 'parent@example.com')).toBe(true);
    expect(normalizeEmailForCompare('  Parent@Example.COM  ')).toBe('parent@example.com');
    expect(validateRegistrationWelcomeEligibility({
      ...base,
      invitationEmail: 'PARENT@example.com',
      requestEmail: 'parent@EXAMPLE.com',
      parentProfileEmail: '  parent@example.com ',
    })).toEqual({ eligible: true });
  });

  it('builds a stable dedupe decision id', () => {
    expect(registrationWelcomeDecisionId('req-1', '2026-10-20T12:00:00.000Z')).toBe(
      'registration_access_activated:2026-10-20T12:00:00.000Z',
    );
  });
});
