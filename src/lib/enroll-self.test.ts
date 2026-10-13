import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { requestEnrollment, type EnrollmentInsertClient } from '../../supabase/functions/enroll-self/enroll';

const USER = '00000000-0000-4000-8000-0000000000c1';
const SUBJECT = '00000000-0000-4000-8000-0000000005b1';

function fakeDb(error: { code?: string; message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ insert });
  return { db: { from } as unknown as EnrollmentInsertClient, from, insert };
}

describe('enroll-self requestEnrollment', () => {
  it('always inserts a pending request for the caller, ignoring forged status and student_id', async () => {
    const { db, from, insert } = fakeDb();
    const res = await requestEnrollment(db, USER, {
      subject_id: SUBJECT,
      status: 'active',
      student_id: '00000000-0000-4000-8000-0000000000ff',
      enrolled_at: '2020-01-01',
    });
    expect(from).toHaveBeenCalledWith('enrollments');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({ student_id: USER, subject_id: SUBJECT, status: 'pending' });
    expect(res).toEqual({ status: 200, body: { success: true, status: 'pending' } });
  });

  it('creates a pending request when no status is supplied', async () => {
    const { db, insert } = fakeDb();
    await requestEnrollment(db, USER, { subject_id: SUBJECT });
    expect(insert.mock.calls[0][0].status).toBe('pending');
  });

  it.each([undefined, null, {}, { subject_id: '' }, { subject_id: '   ' }, { subject_id: 42 }, 'subject'])(
    'rejects a request without a usable subject_id (%j) without writing',
    async (body) => {
      const { db, insert } = fakeDb();
      expect(await requestEnrollment(db, USER, body)).toEqual({ status: 400, body: { error: 'subject_id is required' } });
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it('maps a duplicate enrollment to 409 already_enrolled', async () => {
    const { db } = fakeDb({ code: '23505', message: 'duplicate key' });
    const res = await requestEnrollment(db, USER, { subject_id: SUBJECT });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_enrolled');
  });

  it('maps an RLS refusal to 403', async () => {
    const { db } = fakeDb({ code: '42501', message: 'new row violates row-level security policy' });
    expect((await requestEnrollment(db, USER, { subject_id: SUBJECT })).status).toBe(403);
  });

  it('rethrows other database errors', async () => {
    const { db } = fakeDb({ code: '22P02', message: 'invalid input syntax for type uuid' });
    await expect(requestEnrollment(db, USER, { subject_id: 'not-a-uuid' })).rejects.toMatchObject({ code: '22P02' });
  });
});

describe('enroll-self handler', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/enroll-self/index.ts'), 'utf8');

  it('runs as the caller (anon key + user JWT), never with the service role', () => {
    expect(src).not.toMatch(/SERVICE_ROLE/);
    expect(src).toMatch(/Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
    expect(src).toMatch(/headers:\s*\{\s*Authorization:\s*authHeader\s*\}/);
  });

  it('delegates the write to requestEnrollment and has no inline enrollment insert', () => {
    expect(src).toMatch(/requestEnrollment\(supabase, user\.id, body\)/);
    expect(src).not.toMatch(/\.from\("enrollments"\)/);
    expect(src).not.toMatch(/"active"/);
  });
});
