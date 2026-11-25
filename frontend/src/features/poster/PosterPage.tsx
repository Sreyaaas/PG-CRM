import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Download, Printer } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { Money } from '@/components/Money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingRows, Notice, PageHeader } from '@/components/ui/misc'
import { usePropertyQuery } from '@/features/properties/api'
import { joinUrl } from './qrUrl'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-[#d6d3cc] py-2 text-lg print:border-black">
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

  if (query.isLoading) {
    return (
      <Card>
        <LoadingRows label="Loading poster…" />
      </Card>
    )
  }
  if (query.isError || !p || !url) {
    return (
      <Notice role="alert">
        {query.error instanceof ApiError ? query.error.message : 'Unable to load property.'}
      </Notice>
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6 print:block print:max-w-none">
      <div className="flex flex-col gap-4 print:hidden">
        <PageHeader
          back={{ to: `/owner/properties/${p.id}`, label: 'Back to property' }}
          title="Reception QR"
          description="Print this and put it up at the reception desk."
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button type="button" variant="secondary" disabled={!qrPng} onClick={downloadPng}>
            <Download aria-hidden="true" />
            Download PNG
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print
          </Button>
        </div>
      </div>

      <article
        aria-label="Reception QR poster"
        className="rounded-card border border-line bg-white p-6 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none"
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
          <Notice tone="warning" role="alert" className="mt-6 print:hidden">
            No UPI ID is connected, so the payment warning is not on this poster. Connect the Soundbox QR on
            the property page first.
          </Notice>
        )}
        {p.upi_vpa && (
          <div
            data-testid="upi-warning"
            className="mt-6 rounded-xl border-2 border-black bg-white p-4 text-lg font-semibold"
          >
            Pay rent only to this UPI ID: <span className="break-all">{p.upi_vpa}</span>
            {p.upi_payee_name && <> ({p.upi_payee_name})</>}. Never pay staff personally.
          </div>
        )}
      </article>
    </div>
  )
}
