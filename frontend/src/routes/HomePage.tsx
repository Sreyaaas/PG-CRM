import { useHealthQuery } from '@/features/health/useHealthQuery'

export function HomePage() {
  const { data, isLoading, isError, error } = useHealthQuery()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">PG-CRM</h1>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            MVP
          </span>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Operating system for multi-building PG owners.
        </p>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {isLoading && <span className="text-muted-foreground">API: checking…</span>}
          {isError && (
            <span className="text-destructive">
              API: error ({error instanceof Error ? error.message : 'unavailable'})
            </span>
          )}
          {data && (
            <span className="font-medium text-foreground" data-testid="api-status">
              API: {data.status ?? 'ok'}
            </span>
          )}
        </div>
      </div>
    </main>
  )
}
