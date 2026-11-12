import { useState, useEffect, useCallback } from "react";

export function useCamera() {
  const [cameraSupported, setCameraSupported] = useState<boolean | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      setCameraSupported(true);
    } else {
      setCameraSupported(false);
    }
  }, []);

  const openCamera = useCallback(() => {
    setIsDialogOpen(true);
  }, []);

  const closeCamera = useCallback(() => {
    setIsDialogOpen(false);
  }, []);

  return {
    cameraSupported,
    isDialogOpen,
    openCamera,
    closeCamera,
  };
}
