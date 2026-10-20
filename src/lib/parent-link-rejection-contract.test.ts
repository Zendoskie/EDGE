import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('parent link rejection inbox contract', () => {
  it('notifies registered parents when a student rejects a pending link', () => {
    const sql = read('supabase/migrations/20261020150200_parent_link_student_rejection_inbox.sql');
    expect(sql).toContain("NEW.status = 'rejected'");
    expect(sql).toContain('NEW.parent_user_id');
    expect(sql).toContain('Access request rejected');
  });

  it('implements registration welcome email without user JWT', () => {
    const edge = read('supabase/functions/send-parent-email/index.ts');
    expect(edge).toContain('registration_access_activated');
    expect(edge.indexOf('handleRegistrationAccessActivated')).toBeLessThan(
      edge.indexOf('Missing authorization header'),
    );
    expect(edge).toContain('validateRegistrationWelcomeEligibility');
  });
});
