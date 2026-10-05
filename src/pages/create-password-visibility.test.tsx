import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CompleteStudentRegistration from '@/pages/CompleteStudentRegistration';
import CompleteParentRegistration from '@/pages/CompleteParentRegistration';
import RequestStaffAccount from '@/pages/RequestStaffAccount';

const staff = vi.hoisted(() => ({ role: 'instructor' as 'instructor' | 'guidance_counselor' }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(async (fn: string) => {
      const expires_at = '2099-01-01T00:00:00.000Z';
      if (fn === 'get_student_invitation_by_token') {
        return {
          data: [{
            email: 'student@example.invalid',
            full_name: 'Student Example',
            student_id: 'S-1',
            course: 'CS',
            year_level: '1',
            is_irregular: false,
            status: 'pending',
            expires_at,
          }],
          error: null,
        };
      }
      if (fn === 'get_parent_invitation_by_token') {
        return {
          data: [{
            email: 'parent@example.invalid',
            full_name: 'Parent Example',
            student_id: 'S-1',
            student_name: 'Student Example',
            status: 'pending',
            expires_at,
          }],
          error: null,
        };
      }
      if (fn === 'get_staff_invitation_by_token') {
        return {
          data: [{
            id: 'inv-1',
            email: 'staff@example.invalid',
            full_name: 'Staff Example',
            department: 'CAS',
            role: staff.role,
            status: 'pending',
            expires_at,
          }],
          error: null,
        };
      }
      return { data: null, error: null };
    }),
    auth: { signUp: vi.fn(), signOut: vi.fn() },
    from: vi.fn(),
  },
}));

function renderAt(path: string, element: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

async function expectIndependentPasswordToggles() {
  const password = await screen.findByLabelText(/^Password/);
  const confirm = screen.getByLabelText(/^Confirm password/i);
  const [passwordToggle, confirmToggle] = screen.getAllByRole('button', { name: 'Show password' });

  expect(password).toHaveAttribute('type', 'password');
  expect(confirm).toHaveAttribute('type', 'password');
  expect(passwordToggle.innerHTML).toContain('m2 2 20 20');
  expect(confirmToggle.innerHTML).toContain('m2 2 20 20');

  passwordToggle.focus();
  expect(passwordToggle).toHaveFocus();
  fireEvent.click(passwordToggle);
  expect(password).toHaveAttribute('type', 'text');
  expect(confirm).toHaveAttribute('type', 'password');
  expect(screen.getByRole('button', { name: 'Hide password' }).innerHTML).not.toContain('m2 2 20 20');
  expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('data-state', 'hidden');
  expect(screen.getByRole('button', { name: 'Show password' }).innerHTML).toContain('m2 2 20 20');

  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
  expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2);

  fireEvent.click(screen.getAllByRole('button', { name: 'Show password' })[1]);
  expect(password).toHaveAttribute('type', 'password');
  expect(confirm).toHaveAttribute('type', 'text');
}

describe('Phase 2 create-password eye icons', () => {
  it('student create-password toggles each field on its own', async () => {
    renderAt('/complete-registration?token=test', <CompleteStudentRegistration />);
    await screen.findByRole('heading', { name: /create your password/i });
    await expectIndependentPasswordToggles();
  });

  it('parent create-password toggles each field on its own', async () => {
    renderAt('/complete-parent-registration?token=test', <CompleteParentRegistration />);
    await screen.findByRole('heading', { name: /create your password/i });
    await expectIndependentPasswordToggles();
  });

  it('instructor create-password toggles each field on its own', async () => {
    staff.role = 'instructor';
    renderAt('/request-staff-account?token=test', <RequestStaffAccount />);
    await screen.findByText(/invited to create a Instructor account/i);
    await expectIndependentPasswordToggles();
  });

  it('counselor create-password toggles each field on its own', async () => {
    staff.role = 'guidance_counselor';
    renderAt('/request-staff-account?token=test', <RequestStaffAccount />);
    await screen.findByText(/invited to create a Guidance Counselor account/i);
    await expectIndependentPasswordToggles();
  });
});
