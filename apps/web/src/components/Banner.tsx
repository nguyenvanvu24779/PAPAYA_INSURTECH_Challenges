export interface BannerState {
  kind: 'success' | 'error';
  title: string;
  message: string;
  details?: string[];
}

export function Banner({ banner, onDismiss }: { banner: BannerState | null; onDismiss: () => void }) {
  if (!banner) return <div aria-live="polite" />;
  const isError = banner.kind === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-testid="banner"
      data-kind={banner.kind}
      className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
        isError
          ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
          : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
      }`}
    >
      <div>
        <p className="font-semibold">{banner.title}</p>
        <p className="mt-0.5">{banner.message}</p>
        {banner.details && banner.details.length > 1 && (
          <ul className="mt-1 list-disc pl-5">
            {banner.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded px-1 text-lg leading-none opacity-70 hover:opacity-100" aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}
