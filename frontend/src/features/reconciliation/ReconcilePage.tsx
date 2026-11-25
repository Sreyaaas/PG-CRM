import { useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Upload } from 'lucide-react'
import { DateText } from '@/components/DateText'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardList } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Select } from '@/components/ui/input'
import { EmptyState, ListRow, LoadingRows, Notice, PageHeader, ROW_LINK, SectionHeader, StatTile } from '@/components/ui/misc'
import { cn } from '@/lib/utils'
import {
  errorMessage,
  SOURCE_LABELS,
  useImports,
  useUploadStatement,
  type CsvImport,
  type CsvImportResult,
  type StatementSource,
} from './api'
import { RowsPanel } from './RowsPanel'
import { UnverifiedPanel } from './UnverifiedPanel'

type TabId = 'results' | 'unverified' | 'past'

const TABS: { id: TabId; label: string }[] = [
  { id: 'results', label: 'Results' },
  { id: 'unverified', label: 'Not in any statement' },
  { id: 'past', label: 'Past imports' },
]

const MAX_BYTES = 5 * 1024 * 1024

interface Summary {
  importId: string
  rowCount: number
  matched: number
  mismatch: number
  unmatched: number
  caption: string
}

function fromResult(r: CsvImportResult, fileName: string): Summary {
  return {
    importId: r.import_id,
    rowCount: r.row_count,
    matched: r.matched_count,
    mismatch: r.mismatch_count,
    unmatched: r.unmatched_count,
    caption: fileName,
  }
}

function fromImport(i: CsvImport): Summary {
  return {
    importId: i.id,
    rowCount: i.row_count,
    matched: i.matched_count,
    mismatch: i.mismatch_count,
    unmatched: i.unmatched_count,
    caption: i.file_name,
  }
}

function UploadCard({ onUploaded }: { onUploaded: (s: Summary) => void }) {
  const { showToast } = useToast()
  const upload = useUploadStatement()
  const [source, setSource] = useState<StatementSource>('paytm_business')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!file) {
      setFileError('Choose the statement CSV first.')
      return
    }
    upload.mutate(
      { source, file },
      {
        onSuccess: (result) => {
          onUploaded(fromResult(result, file.name))
          showToast('Statement reconciled', 'success')
          setFile(null)
          if (inputRef.current) inputRef.current.value = ''
        },
        onError: (err) => showToast(errorMessage(err, 'Unable to upload the statement. Please try again.'), 'error'),
      },
    )
  }

  return (
    <Card>
      <CardHeader title="Upload a statement" description="Payments with a matching UTR and amount become Verified." />
      <CardBody>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end" noValidate>
          <Field id="statement-source" label="Statement source">
            <Select id="statement-source" value={source} onChange={(e) => setSource(e.target.value as StatementSource)}>
              {(Object.keys(SOURCE_LABELS) as StatementSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="statement-file" label="Statement CSV" hint="CSV, up to 5 MB." error={fileError}>
            <Input
              ref={inputRef}
              id="statement-file"
              type="file"
              accept=".csv,text/csv"
              className="py-2 text-[14px] file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1 file:text-[13px] file:font-medium file:text-ink"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                if (f && f.size > MAX_BYTES) {
                  setFile(null)
                  setFileError('This file is larger than 5 MB.')
                  return
                }
                setFile(f)
                setFileError(undefined)
              }}
            />
          </Field>
          <Button type="submit" variant="brand" disabled={upload.isPending} className="sm:mb-[22px]">
            <Upload aria-hidden="true" />
            {upload.isPending ? 'Uploading…' : 'Upload and reconcile'}
          </Button>
        </form>
        {upload.isPending && (
          <div role="status" className="mt-4 flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">Uploading and matching UTRs…</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full w-1/3 animate-[pulse-soft_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function SummaryTiles({ summary }: { summary: Summary }) {
  return (
    <section aria-label="Reconciliation summary" className="flex flex-col gap-2.5">
      <SectionHeader title="Result" description={`${summary.caption} · ${summary.rowCount} credit rows read`} />
      <div className="grid grid-cols-3 gap-2.5">
        <StatTile
          label="Matched"
          icon={<CheckCircle2 aria-hidden="true" className="text-success" />}
          value={<span data-testid="count-matched" className="text-success-ink">{summary.matched}</span>}
        />
        <StatTile
          label="Mismatch"
          icon={<AlertTriangle aria-hidden="true" className="text-danger" />}
          value={<span data-testid="count-mismatch" className="text-danger-ink">{summary.mismatch}</span>}
        />
        <StatTile
          label="Not logged"
          icon={<CircleDashed aria-hidden="true" />}
          value={<span data-testid="count-unmatched">{summary.unmatched}</span>}
        />
      </div>
    </section>
  )
}

function PastImports({ imports, onOpen }: { imports: CsvImport[]; onOpen: (i: CsvImport) => void }) {
  return (
    <Card className="overflow-hidden">
      {imports.length === 0 ? (
        <EmptyState>No statements uploaded yet.</EmptyState>
      ) : (
        <CardList aria-label="Past imports">
          {imports.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onOpen(i)} className={cn(ROW_LINK, 'w-full text-left')}>
                <ListRow
                  title={i.file_name}
                  meta={
                    <>
                      {SOURCE_LABELS[i.source]} · <DateText value={i.created_at} /> · {i.uploaded_by_name}
                    </>
                  }
                  trailing={
                    <span className="text-[12.5px] text-muted tabular-nums">
                      {i.matched_count} matched · {i.mismatch_count} mismatch · {i.unmatched_count} not logged
                    </span>
                  }
                />
              </button>
            </li>
          ))}
        </CardList>
      )}
    </Card>
  )
}

export function ReconcilePage() {
  const imports = useImports()
  const [tab, setTab] = useState<TabId>('results')
  const [picked, setPicked] = useState<Summary | null>(null)

  const latest = imports.data?.[0]
  const summary = picked ?? (latest ? fromImport(latest) : null)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={{ to: '/owner/money', label: 'Money' }}
        title="Reconcile"
        description="Upload your bank or Paytm statement to verify logged UPI payments."
      />

      <UploadCard
        onUploaded={(s) => {
          setPicked(s)
          setTab('results')
        }}
      />

      {summary && <SummaryTiles summary={summary} />}

      <div role="tablist" aria-label="Reconciliation" className="-mb-2 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`recon-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="recon-panel"
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[14px] font-medium transition-colors',
              tab === t.id ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="recon-panel" role="tabpanel" aria-labelledby={`recon-tab-${tab}`} className="pt-1">
        {tab === 'results' &&
          (summary ? (
            <RowsPanel key={summary.importId} importId={summary.importId} />
          ) : imports.isLoading ? (
            <Card>
              <LoadingRows label="Loading…" />
            </Card>
          ) : (
            <Card>
              <EmptyState>Upload a statement to see which payments match.</EmptyState>
            </Card>
          ))}
        {tab === 'unverified' && <UnverifiedPanel />}
        {tab === 'past' && (
          <>
            {imports.isError && <Notice role="alert">{errorMessage(imports.error, 'Unable to load past imports.')}</Notice>}
            {imports.isLoading && (
              <Card>
                <LoadingRows label="Loading past imports…" />
              </Card>
            )}
            {imports.data && (
              <PastImports
                imports={imports.data}
                onOpen={(i) => {
                  setPicked(fromImport(i))
                  setTab('results')
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
