import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { getSignedIdUrl } from '@/lib/id-verification';

function IdImage({ label, path }: { label: string; path: string | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  useEffect(() => {
    let cancelled = false;
    setLoading(!!path);
    setUrl(null);
    if (!path) return;
    getSignedIdUrl(path).then((signed) => {
      if (cancelled) return;
      setUrl(signed);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [path]);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer" className="group block">
          <img
            src={url}
            alt={`${label} of submitted ID`}
            className="h-40 w-full rounded-lg border border-border/50 object-contain bg-muted/30"
          />
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground">
            <ExternalLink className="h-3 w-3" /> Open full image
          </span>
        </a>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-xs text-muted-foreground">
          No {label.toLowerCase()} on file
        </div>
      )}
    </div>
  );
}

/** Front/back ID viewer used by administrator review screens. */
export default function IdPreview({ frontPath, backPath }: { frontPath: string | null; backPath: string | null }) {
  if (!frontPath && !backPath) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <IdImage label="Front of ID" path={frontPath} />
      <IdImage label="Back of ID" path={backPath} />
    </div>
  );
}
