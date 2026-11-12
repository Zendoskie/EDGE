import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import IdVerificationUpload from '@/components/IdVerificationUpload';

describe('IdVerificationUpload', () => {
  it('offers upload and camera options for both sides', () => {
    render(<IdVerificationUpload value={{ front: null, back: null }} onChange={() => {}} />);

    expect(screen.getByText('Valid ID')).toBeInTheDocument();
    expect(screen.getByText('Front of ID')).toBeInTheDocument();
    expect(screen.getByText('Back of ID')).toBeInTheDocument();
    // Two sides × (upload + camera)
    expect(screen.getAllByRole('button', { name: /upload file/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /camera/i })).toHaveLength(2);
    expect(screen.getByLabelText('Upload Front of ID')).toHaveAttribute('accept', 'image/*');
    expect(screen.getByLabelText('Upload Back of ID')).toHaveAttribute('accept', 'image/*');
    expect(screen.getByRole('button', { name: 'Capture Back of ID with camera' })).toBeInTheDocument();
  });
});
