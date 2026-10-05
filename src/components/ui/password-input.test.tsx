import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from '@/components/ui/password-input';

function isOpenEye(button: HTMLElement) {
  return button.querySelector('circle') != null && !button.innerHTML.includes('m2 2 20 20');
}

function isCrossedEye(button: HTMLElement) {
  return button.innerHTML.includes('m2 2 20 20');
}

describe('PasswordInput visibility icon', () => {
  it('starts hidden with a crossed eye, then shows an open eye while the password is visible', () => {
    render(<PasswordInput aria-label="Password" />);

    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });

    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('data-state', 'hidden');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(isCrossedEye(toggle)).toBe(true);

    fireEvent.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('data-state', 'visible');
    expect(isOpenEye(screen.getByRole('button', { name: 'Hide password' }))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));

    expect(input).toHaveAttribute('type', 'password');
    expect(isCrossedEye(screen.getByRole('button', { name: 'Show password' }))).toBe(true);
  });

  it('stays in tab order and keeps a second field independent', () => {
    render(
      <>
        <PasswordInput aria-label="Password" />
        <PasswordInput aria-label="Confirm password" />
      </>,
    );

    const [passwordToggle, confirmToggle] = screen.getAllByRole('button', { name: 'Show password' });
    expect(passwordToggle).toHaveAttribute('type', 'button');
    passwordToggle.focus();
    expect(passwordToggle).toHaveFocus();
    fireEvent.keyDown(passwordToggle, { key: 'Enter' });
    fireEvent.click(passwordToggle);

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');
    expect(confirmToggle).toHaveAttribute('data-state', 'hidden');

    fireEvent.click(confirmToggle);

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
  });
});
