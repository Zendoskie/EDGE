import { useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { validateIdImage, type IdSide } from '@/lib/id-verification';
import { useCamera } from '@/hooks/use-camera';
import { CameraCaptureDialog } from '@/components/camera-capture-dialog';

type SideState = {
  front: { file: File | null; preview: string | null };
  back: { file: File | null; preview: string | null };
};

export type IdVerificationValue = {
  front: File | null;
  back: File | null;
};

type Props = {
  value: IdVerificationValue;
  onChange: (next: IdVerificationValue) => void;
  disabled?: boolean;
  error?: string | null;
};

function SideUploader({
  side,
  file,
  onFile,
  disabled,
}: {
  side: IdSide;
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { cameraSupported, isDialogOpen, openCamera, closeCamera } = useCamera();
  const label = side === 'front' ? 'Front of ID' : 'Back of ID';

  const pickFile = (input: HTMLInputElement | null) => {
    if (!disabled && input) input?.click();
  };

  const handleFiles = (list: FileList | null) => {
    const next = list?.[0] ?? null;
    onFile(next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label} <span className="text-destructive">*</span></Label>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={`Upload ${label}`}
        onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ''; }}
      />
      <CameraCaptureDialog
        isOpen={isDialogOpen}
        onClose={closeCamera}
        onCapture={onFile}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2">
          <img
            src={URL.createObjectURL(file)}
            alt={`${label} preview`}
            className="h-16 w-24 rounded-md border border-border/50 object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{file.name}</p>
            <p className="text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label}`} onClick={() => onFile(null)} disabled={disabled}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => pickFile(fileRef.current)} disabled={disabled}>
            <ImagePlus className="h-4 w-4" /> Upload file
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label={`Capture ${label} with camera`}
            onClick={openCamera}
            disabled={disabled || cameraSupported === false}
          >
            <Camera className="h-4 w-4" />
            {cameraSupported === null ? 'Checking…' : cameraSupported ? 'Use camera' : 'No camera'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Front + back ID capture with a file picker and a camera-capture option for each side. */
export default function IdVerificationUpload({ value, onChange, disabled, error }: Props) {
  const [state, setState] = useState<SideState>({
    front: { file: null, preview: null },
    back: { file: null, preview: null },
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const setSide = (side: IdSide, file: File | null) => {
    const validation = validateIdImage(file);
    if (validation) {
      setValidationError(validation);
      return;
    }
    setValidationError(null);
    setState((prev) => {
      const entry = { file, preview: file ? URL.createObjectURL(file) : null };
      return side === 'front' ? { ...prev, front: entry } : { ...prev, back: entry };
    });
    onChange({ ...value, [side]: file });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="space-y-0.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Valid ID</p>
        <p className="text-[11px] text-muted-foreground">
          Upload or capture the front and back of a government or school ID. JPEG or PNG, up to 10 MB each.
        </p>
      </div>
      <SideUploader side="front" file={state.front.file} onFile={(f) => setSide('front', f)} disabled={disabled} />
      <SideUploader side="back" file={state.back.file} onFile={(f) => setSide('back', f)} disabled={disabled} />
      {validationError ? <p className="edge-auth-error">{validationError}</p> : null}
      {error ? <p className="edge-auth-error">{error}</p> : null}
    </div>
  );
}
