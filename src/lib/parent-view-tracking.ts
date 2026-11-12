import { supabase } from '@/integrations/supabase/client';

/**
 * Records one parent check-in on a linked student account.
 * The database enforces the approved link and the 30-minute dedupe window,
 * so a rejected or absent link is a silent no-op (false).
 */
export async function trackParentStudentView(
  studentUserId: string,
  page = 'parent-performance',
): Promise<boolean> {
  if (!studentUserId) return false;

  try {
    const { data, error } = await supabase.rpc('record_parent_student_view', {
      p_student_user_id: studentUserId,
      p_page: page,
    });

    if (error) {
      const missing =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        (error.message ?? '').toLowerCase().includes('could not find the function');
      if (!missing) {
        console.warn('[parent-engagement] check-in was not recorded:', error.message);
      }
      return false;
    }

    return data === true;
  } catch (err) {
    console.warn('[parent-engagement] check-in was not recorded:', err);
    return false;
  }
}
