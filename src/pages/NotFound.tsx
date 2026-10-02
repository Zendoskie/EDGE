import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="peoplo-canvas flex min-h-screen items-center justify-center px-4">
      <div className="rounded-[22px] border border-border bg-card px-8 py-10 text-center shadow-[0_16px_40px_-28px_hsl(234_60%_40%/0.45)]">
        <h1 className="mb-2 text-4xl font-semibold">404</h1>
        <p className="mb-4 text-muted-foreground">This page is not part of EDGE.</p>
        <a href="/" className="text-sm font-medium text-primary">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
