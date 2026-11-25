import { Building2, ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardList } from '@/components/ui/card'
import { EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK } from '@/components/ui/misc'
import { usePropertiesQuery } from './api'
import { ActiveBadge } from './ActiveBadge'

export function PropertiesListPage() {
  const query = usePropertiesQuery()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Properties"
        actions={
          <Button asChild>
            <Link to="/owner/properties/new">
              <Plus aria-hidden="true" />
              Add property
            </Link>
          </Button>
        }
      />

      {query.isError && (
        <Notice role="alert">
          {query.error instanceof ApiError ? query.error.message : 'Unable to load properties.'}
        </Notice>
      )}

      {!query.isError && (
        <Card className="overflow-hidden">
          {query.isLoading && <LoadingRows label="Loading properties…" />}
          {query.data && query.data.length === 0 && <EmptyState>No properties yet. Add your first building.</EmptyState>}
          {query.data && query.data.length > 0 && (
            <CardList>
              {query.data.map((p) => (
                <li key={p.id}>
                  <Link to={`/owner/properties/${p.id}`} className={ROW_LINK}>
                    <ListRow
                      leading={
                        <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                          <Building2 className="size-5" aria-hidden="true" />
                        </span>
                      }
                      title={p.name}
                      meta={p.locality ?? undefined}
                      trailing={
                        <>
                          <ActiveBadge active={p.is_active} />
                          <ChevronRight className="size-4 text-subtle" aria-hidden="true" />
                        </>
                      }
                    />
                  </Link>
                </li>
              ))}
            </CardList>
          )}
        </Card>
      )}
    </div>
  )
}
