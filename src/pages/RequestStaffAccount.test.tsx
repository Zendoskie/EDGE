import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestStaffAccount from '@/pages/RequestStaffAccount';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: { signUp: vi.fn(), signOut: vi.fn() },
  },
}));

describe('Staff account request', () => {
  it('asks for instructor or counselor details and does not ask for a password', () => {
    render(
      <MemoryRouter>
        <RequestStaffAccount />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Instructor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guidance Counselor' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/parent gmail/i)).not.toBeInTheDocument();
  });
});
