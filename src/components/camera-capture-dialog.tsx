import { useRef, useState, useEffect, useCallback } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
};

export function CameraCaptureDialog({ isOpen, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (isOpen) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((s) => {
          setStream(s);
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
        })
        .catch((err) => console.error('Error accessing camera:', err));
    } else {
      stream?.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [isOpen]);

  const handleCapture = useCallback(() => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'id-capture.jpg', { type: 'image/jpeg' });
            onCapture(file);
            onClose();
          }
        }, 'image/jpeg');
      }
    }
  }, [onCapture, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Capture ID</DialogTitle>
        </DialogHeader>
        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
        </div>
        <div className="flex justify-center">
          <Button type="button" onClick={handleCapture} className="gap-2">
            <Camera className="h-4 w-4" /> Capture
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
