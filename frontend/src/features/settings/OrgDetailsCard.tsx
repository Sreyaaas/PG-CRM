import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/api/client'
import type { components } from '@/api/schema'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input, Select, Textarea } from '@/components/ui/input'
import { LoadingRows, Notice } from '@/components/ui/misc'
import { useAuth } from '@/features/auth/AuthContext'
import { useOrgId } from '@/features/properties/api'

type Organization = components['schemas']['Organization']
type Language = Organization['whatsapp_language']

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  kn: 'Kannada',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
}

// 15 characters: state code, PAN, entity number, Z, check digit.
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

function useOrganization() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ['organization', orgId],
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async () => {
      const { data } = await apiClient.GET('/api/v1/organization', { params: { header: { 'x-org-id': orgId } } })
      if (!data || typeof data.name !== 'string') throw new Error('Unable to load business details.')
      return data
    },
  })
}

export function OrgDetailsCard() {
  const { updateMe } = useAuth()
  const query = useOrganization()
  // Optional card: if the details can't be loaded, leave it out rather than alarm the owner.
  if (query.isError) return null
  return (
    <Card>
      <CardHeader title="Business details" description="On receipts, the reception poster and WhatsApp messages" />
      <CardBody>
        {query.isLoading && <LoadingRows label="Loading business details…" rows={2} />}
        {query.data && <OrgDetailsForm key={query.data.id + query.data.name} org={query.data} />}
      </CardBody>
    </Card>
  )
}

function OrgDetailsForm({ org }: { org: Organization }) {
  const orgId = useOrgId()
  const qc = useQueryClient()
  const { showToast } = useToast()
  const [name, setName] = useState(org.name)
  const [gstin, setGstin] = useState(org.gstin ?? '')
  const [language, setLanguage] = useState<Language>(org.whatsapp_language)
  const [footer, setFooter] = useState(org.receipt_footer ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.PATCH('/api/v1/organization', {
        params: { header: { 'x-org-id': orgId } },
        body: {
          name: name.trim(),
          gstin: gstin.trim() || null,
          whatsapp_language: language,
          receipt_footer: footer.trim() || null,
        },
      })
      return data
    },
    onSuccess: async () => {
      showToast('Business details saved', 'success')
      qc.invalidateQueries({ queryKey: ['organization', orgId] })
      try {
        const { data } = await apiClient.GET('/api/v1/me')
        if (data) updateMe(data)
      } catch {
        // non-fatal: next login/refresh will sync
      }
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Unable to save.'),
  })

  const dirty =
    name.trim() !== org.name ||
    (gstin.trim() || null) !== (org.gstin ?? null) ||
    language !== org.whatsapp_language ||
    (footer.trim() || null) !== (org.receipt_footer ?? null)
  const gstinInvalid = gstin.trim() !== '' && !GSTIN.test(gstin.trim())

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim().length < 2) return setError('Enter your business name.')
        if (gstinInvalid) return setError('GSTIN should be 15 characters, like 29ABCDE1234F1Z5.')
        setError(null)
        save.mutate()
      }}
    >
      {error && <Notice role="alert">{error}</Notice>}
      <Field id="org-name" label="Business name">
        <Input id="org-name" value={name} maxLength={120} autoComplete="organization" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field
        id="org-gstin"
        label="GSTIN (optional)"
        hint="Printed on receipts when set."
        error={gstinInvalid ? 'Check the GSTIN: 15 letters and digits.' : undefined}
      >
        <Input
          id="org-gstin"
          value={gstin}
          maxLength={15}
          autoCapitalize="characters"
          spellCheck={false}
          className="uppercase tabular-nums"
          placeholder="29ABCDE1234F1Z5"
          onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
        />
      </Field>
      <Field id="org-language" label="WhatsApp message language" hint="Used for receipts and rent reminders.">
        <Select id="org-language" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABELS[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="org-footer" label="Receipt footer (optional)" hint="A short line at the bottom of every receipt.">
        <Textarea
          id="org-footer"
          rows={2}
          maxLength={300}
          value={footer}
          placeholder="Thank you. For queries call the reception desk."
          onChange={(e) => setFooter(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  )
}
