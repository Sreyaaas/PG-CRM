import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiClient } from '@/api/client'
import { useToast } from '@/components/Toast'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { Notice } from '@/components/ui/misc'
import { useOrgId, type UpiPayeeDetails } from './api'

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

/**
 * Starts the camera in `video` and calls `onText` with the first QR text found.
 * Uses the native BarcodeDetector API when present, otherwise the qr-scanner library.
 * Returns a stop function.
 */
async function startScan(video: HTMLVideoElement, onText: (text: string) => void) {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (Detector) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    })
    video.srcObject = stream
    await video.play()
    const detector = new Detector({ formats: ['qr_code'] })
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const codes = await detector.detect(video)
        if (codes.length > 0 && codes[0].rawValue) {
          onText(codes[0].rawValue)
          return
        }
      } catch {
        // ignore a failed frame and keep scanning
      }
      setTimeout(tick, 250)
    }
    void tick()
    return () => {
      stopped = true
      stream.getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }
  }

  const { default: QrScanner } = await import('qr-scanner')
  const scanner = new QrScanner(video, (result) => onText(result.data), {
    preferredCamera: 'environment',
    returnDetailedScanResult: true,
    highlightScanRegion: false,
  })
  await scanner.start()
  return () => {
    scanner.stop()
    scanner.destroy()
  }
}

export function ConnectSoundboxQr({ propertyId }: { propertyId: string }) {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const [scanning, setScanning] = useState(false)
  const [pasted, setPasted] = useState('')
  const [details, setDetails] = useState<UpiPayeeDetails | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const submitMutation = useMutation({
    mutationFn: async (qrText: string) => {
      const { data } = await apiClient.POST('/api/v1/properties/{property_id}/upi-from-qr', {
        params: { path: { property_id: propertyId }, header: { 'x-org-id': orgId } },
        body: { qr_text: qrText },
      })
      if (!data) throw new Error('Empty response')
      return data
    },
    onSuccess: async (data) => {
      setDetails(data)
      setConfirmed(false)
      setPasted('')
      await queryClient.invalidateQueries({ queryKey: ['properties'] })
    },
    onError: (err) => {
      showToast(err instanceof ApiError ? err.message : 'Unable to read this QR.', 'error')
    },
  })

  function stopCamera() {
    stopRef.current?.()
    stopRef.current = null
    setScanning(false)
  }

  useEffect(() => () => stopRef.current?.(), [])

  async function openCamera() {
    setScanning(true)
    // Wait for the <video> element to mount.
    await new Promise((r) => setTimeout(r, 0))
    try {
      stopRef.current = await startScan(videoRef.current!, (text) => {
        stopCamera()
        submitMutation.mutate(text)
      })
    } catch {
      setScanning(false)
      showToast('Could not open the camera. Paste the QR text instead.', 'error')
    }
  }

  const cameraSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Connect Soundbox QR" description="Scan the QR on your shop's Soundbox" />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {details && !confirmed && (
          <div className="flex flex-col gap-3 rounded-card border border-line-strong bg-surface-2 p-4" data-testid="upi-confirm">
            <div>
              <div className="text-[12.5px] text-muted">Payee name</div>
              <div className="text-[20px] font-bold tracking-[-0.02em] text-ink">
                {details.upi_payee_name ?? 'No name in QR'}
              </div>
            </div>
            <div>
              <div className="text-[12.5px] text-muted">UPI ID</div>
              <div className="break-all text-[20px] font-bold tracking-[-0.02em] text-ink">{details.upi_vpa}</div>
            </div>
            {details.warning && (
              <Notice tone="warning" role="alert">
                {details.warning}
              </Notice>
            )}
            <p className="text-[14px] font-semibold text-ink">Is this your business name and UPI ID?</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setDetails(null)}>
                No, scan again
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmed(true)
                  showToast('Soundbox QR connected', 'success')
                }}
              >
                Yes, correct
              </Button>
            </div>
          </div>
        )}

        {details && confirmed && (
          <Notice tone="success">
            Connected to {details.upi_payee_name ?? details.upi_vpa}.{' '}
            <button
              type="button"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
              onClick={() => {
                setDetails(null)
                setConfirmed(false)
              }}
            >
              Replace QR
            </button>
          </Notice>
        )}

        {!details && (
          <>
            {cameraSupported && !scanning && (
              <Button type="button" block onClick={openCamera}>
                <ScanLine aria-hidden="true" />
                Scan with camera
              </Button>
            )}
            {scanning && (
              <div className="flex flex-col gap-2">
                <video ref={videoRef} playsInline muted className="aspect-square w-full rounded-card bg-black object-cover" />
                <Button type="button" variant="secondary" block onClick={stopCamera}>
                  Cancel
                </Button>
              </div>
            )}

            <Field id="qr-text" label="Or paste the QR text">
              <Textarea
                id="qr-text"
                rows={3}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="upi://pay?pa=..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              block
              disabled={!pasted.trim() || submitMutation.isPending}
              onClick={() => submitMutation.mutate(pasted.trim())}
            >
              {submitMutation.isPending ? 'Reading…' : 'Read QR text'}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}
