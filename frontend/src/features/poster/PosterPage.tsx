import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { usePropertyQuery } from '@/features/properties/api'
import { joinUrl } from './qrUrl'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-slate-300 py-2 text-lg print:border-black">
      <dt>{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  )
}

export function PosterPage() {
  const { propertyId } = useParams()
  const query = usePropertyQuery(propertyId)
  const p = query.data
  const url = p ? joinUrl(p.qr_slug) : null
  const [qrPng, setQrPng] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 })
      .then((png) => {
        if (!cancelled) setQrPng(png)
      })
      .catch(() => {
        if (!cancelled) setQrPng(null)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading poster…</p>
  if (query.isError || !p || !url) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </div>
    )
  }

  function downloadPng() {
    if (!qrPng) return
    const a = document.createElement('a')
    a.href = qrPng
    a.download = `reception-qr-${p!.qr_slug}.png`
    a.click()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 print:max-w-none">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          to={`/owner/properties/${p.id}`}
          className="mr-auto text-xs text-slate-500 underline underline-offset-4"
        >
          Back to property
        </Link>
        <Button type="button" variant="outline" className="h-11" disabled={!qrPng} onClick={downloadPng}>
          Download PNG
        </Button>
        <Button
          type="button"
          className="h-11 bg-slate-900 text-white hover:bg-slate-800"
          onClick={() => window.print()}
        >
          Print
        </Button>
      </div>

      <article
        aria-label="Reception QR poster"
        className="rounded-lg border border-slate-200 bg-white p-6 text-slate-950 print:rounded-none print:border-0 print:p-0 print:text-black"
      >
        <h1 className="text-center text-4xl font-bold tracking-tight">{p.name}</h1>
        <p className="mt-2 text-center text-2xl font-medium">Scan to check in</p>

        <div className="mt-6 flex flex-col items-center">
          {qrPng ? (
            <img
              src={qrPng}
              alt={`QR code to check in at ${p.name}`}
              className="h-auto w-full max-w-md print:w-[13cm] print:max-w-none"
            />
          ) : (
            <div className="aspect-square w-full max-w-md" />
          )}
          <p data-testid="poster-url" className="mt-2 break-all text-center text-sm">
            {url}
          </p>
        </div>

        <dl className="mt-6">
          {p.short_term_daily_rate_paise != null && (
            <Fact label="Daily rate (short stay)">
              <Money paise={p.short_term_daily_rate_paise} />
            </Fact>
          )}
          <Fact label="Security deposit">
            <Money paise={p.security_deposit_paise} />
          </Fact>
          <Fact label="Maintenance charge">
            <Money paise={p.maintenance_charge_paise} />
          </Fact>
          <Fact label="Exit deduction">
            <Money paise={p.exit_deduction_paise} />
          </Fact>
        </dl>

        {p.house_rules && (
          <section className="mt-5">
            <h2 className="text-lg font-semibold">House rules</h2>
            <p className="mt-1 whitespace-pre-line text-base">{p.house_rules}</p>
          </section>
        )}

        {!p.upi_vpa && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 print:hidden"
          >
            No UPI ID is connected, so the payment warning is not on this poster. Connect the Soundbox QR on
            the property page first.
          </div>
        )}
        {p.upi_vpa && (
          <div
            data-testid="upi-warning"
            className="mt-6 rounded-md border-2 border-amber-500 bg-amber-50 p-4 text-lg font-semibold print:border-black print:bg-white"
          >
            Pay rent only to this UPI ID: <span className="break-all">{p.upi_vpa}</span>
            {p.upi_payee_name && <> ({p.upi_payee_name})</>}. Never pay staff personally.
          </div>
        )}
      </article>
    </div>
  )
}
