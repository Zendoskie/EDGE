import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '@/pages/Login';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
    rpc: vi.fn(async () => ({ error: null })),
  },
}));

describe('Login signup form', () => {
  it('student signup does not ask for a Parent Gmail', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /switch to sign up/i })[0]);

    expect(await screen.findByLabelText(/student no\./i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/parent gmail/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/parent gmail/i)).not.toBeInTheDocument();
  });

  it('parent signup asks for the student Student ID', async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /switch to sign up/i })[0]);

    fireEvent.click(document.getElementById('signup-role')!);
    fireEvent.click(screen.getByRole('option', { name: /parent \/ guardian/i }));

    expect(await screen.findByLabelText(/^student id$/i)).toBeInTheDocument();
  });
});
