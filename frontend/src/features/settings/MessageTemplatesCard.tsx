import { useState } from 'react'
import { useToast } from '@/components/Toast'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Select, Textarea } from '@/components/ui/input'

export type TemplateLang = 'en' | 'hinglish' | 'hi' | 'kn' | 'te' | 'ta'

interface Templates {
  reminder: string
  receipt: string
  welcome: string
}

const DEFAULTS: Record<TemplateLang, Templates> = {
  en: {
    reminder: 'Hi {name}, your PG rent of {amount} for bed {bed} is due. Please pay at your earliest.',
    receipt: 'Hi {name}, we received {amount} for bed {bed}. Thank you!',
    welcome: 'Welcome {name} to {pg}! Your bed is {bed}. Let us know if you need anything.',
  },
  hinglish: {
    reminder: 'Hi {name}, aapka bed {bed} ka rent {amount} due hai. Please jaldi pay kar dijiye.',
    receipt: 'Hi {name}, aapka {amount} payment bed {bed} ke liye mil gaya hai. Thank you!',
    welcome: 'Welcome {name} to {pg}! Aapka bed {bed} hai. Koi bhi help chahiye toh batayein.',
  },
  hi: {
    reminder: 'नमस्ते {name}, आपके बेड {bed} का किराया {amount} बकाया है। कृपया जल्द भुगतान करें।',
    receipt: 'नमस्ते {name}, बेड {bed} के लिए {amount} प्राप्त हुए। धन्यवाद!',
    welcome: '{pg} में आपका स्वागत है {name}! आपका बेड {bed} है।',
  },
  kn: {
    reminder: 'ನಮಸ್ಕಾರ {name}, ನಿಮ್ಮ ಬೆಡ್ {bed} ಬಾಡಿಗೆ {amount} ಬಾಕಿ ಇದೆ. ದಯವಿಟ್ಟು ಶೀಘ್ರ ಪಾವತಿಸಿ.',
    receipt: 'ನಮಸ್ಕಾರ {name}, ಬೆಡ್ {bed} ಗಾಗಿ {amount} ಪಾವತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ಧನ್ಯವಾದಗಳು!',
    welcome: '{pg} ಗೆ ಸ್ವಾಗತ {name}! ನಿಮ್ಮ ಬೆಡ್ {bed}.',
  },
  te: {
    reminder: 'నమస్కారం {name}, మీ బెడ్ {bed} అద్దె {amount} బకాయి ఉంది. దయచేసి త్వరగా చెల్లించండి.',
    receipt: 'నమస్కారం {name}, బెడ్ {bed} కోసం {amount} అందింది. ధన్యవాదాలు!',
    welcome: '{pg} కు స్వాగతం {name}! మీ బెడ్ {bed}.',
  },
  ta: {
    reminder: 'வணக்கம் {name}, உங்கள் படுக்கை {bed} வாடகை {amount} நிலுவையில் உள்ளது. தயவுசெய்து விரைவில் செலுத்தவும்.',
    receipt: 'வணக்கம் {name}, படுக்கை {bed} க்கு {amount} பெறப்பட்டது. நன்றி!',
    welcome: '{pg} க்கு வரவேற்கிறோம் {name}! உங்கள் படுக்கை {bed}.',
  },
}

const STORAGE_KEY = 'nivasos_msg_templates'

function loadSaved(): { lang: TemplateLang; templates: Templates } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as { lang: TemplateLang; templates: Templates }
  } catch {
    // ignore
  }
  return { lang: 'en', templates: DEFAULTS.en }
}

export function MessageTemplatesCard() {
  const { showToast } = useToast()
  const initial = loadSaved()
  const [lang, setLang] = useState<TemplateLang>(initial.lang)
  const [templates, setTemplates] = useState<Templates>(initial.templates)

  const handleLangChange = (next: TemplateLang) => {
    setLang(next)
    setTemplates(DEFAULTS[next])
  }

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang, templates }))
    showToast('Message templates saved', 'success')
  }

  return (
    <Card>
      <CardHeader
        title="WhatsApp message templates"
        description="Choose a language and customize messages sent to tenants. Placeholders: {name}, {amount}, {bed}, {pg}"
      />
      <CardBody className="flex flex-col gap-4">
        <Field id="tpl-lang" label="Language">
          <Select id="tpl-lang" value={lang} onChange={(e) => handleLangChange(e.target.value as TemplateLang)}>
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi">Hindi (हिन्दी)</option>
            <option value="kn">Kannada (ಕನ್ನಡ)</option>
            <option value="te">Telugu (తెలుగు)</option>
            <option value="ta">Tamil (தமிழ்)</option>
          </Select>
        </Field>
        <Field id="tpl-reminder" label="Rent reminder">
          <Textarea
            id="tpl-reminder"
            rows={2}
            value={templates.reminder}
            onChange={(e) => setTemplates((t) => ({ ...t, reminder: e.target.value }))}
          />
        </Field>
        <Field id="tpl-receipt" label="Payment receipt">
          <Textarea
            id="tpl-receipt"
            rows={2}
            value={templates.receipt}
            onChange={(e) => setTemplates((t) => ({ ...t, receipt: e.target.value }))}
          />
        </Field>
        <Field id="tpl-welcome" label="Welcome message">
          <Textarea
            id="tpl-welcome"
            rows={2}
            value={templates.welcome}
            onChange={(e) => setTemplates((t) => ({ ...t, welcome: e.target.value }))}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setTemplates(DEFAULTS[lang])}>
            Reset
          </Button>
          <Button type="button" variant="brand" onClick={save}>
            Save templates
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
