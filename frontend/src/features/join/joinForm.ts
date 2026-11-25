import type { OnboardingSubmit } from './api'

export type JoinStep = 0 | 1 | 2 | 3

export const JOIN_STEPS = [
  { id: 'about', title: 'About you' },
  { id: 'emergency', title: 'Emergency contact' },
  { id: 'id', title: 'ID & selfie' },
  { id: 'rules', title: 'Charges & rules' },
] as const

export const OCCUPATION_OPTIONS: Array<{ value: OnboardingSubmit['occupation']; label: string }> = [
  { value: 'working', label: 'Working' },
  { value: 'student', label: 'Student' },
  { value: 'other', label: 'Other' },
]

export const ID_DOC_OPTIONS: Array<{ value: OnboardingSubmit['id_doc_type']; label: string }> = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
]

export interface JoinFormState {
  step: JoinStep
  full_name: string
  phone: string
  email: string
  date_of_birth: string
  permanent_address: string
  occupation: OnboardingSubmit['occupation']
  employer_or_college: string
  emergency_contact_name: string
  emergency_contact_phone: string
  id_doc_type: OnboardingSubmit['id_doc_type']
  id_doc_number: string
  id_doc_path: string
  selfie_path: string
  is_foreign_national: boolean
  passport_number: string
  visa_number: string
  visa_expiry: string
  accepted_rules: boolean
}

export const INITIAL_JOIN_STATE: JoinFormState = {
  step: 0,
  full_name: '',
  phone: '',
  email: '',
  date_of_birth: '',
  permanent_address: '',
  occupation: 'working',
  employer_or_college: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  id_doc_type: 'aadhaar',
  id_doc_number: '',
  id_doc_path: '',
  selfie_path: '',
  is_foreign_national: false,
  passport_number: '',
  visa_number: '',
  visa_expiry: '',
  accepted_rules: false,
}

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function draftKey(slug: string): string {
  return `pgcrm_join_draft:${slug}`
}

export function loadJoinDraft(slug: string): JoinFormState {
  if (typeof window === 'undefined') return INITIAL_JOIN_STATE
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug))
    if (!raw) return INITIAL_JOIN_STATE
    const parsed = JSON.parse(raw) as Partial<JoinFormState>
    return {
      ...INITIAL_JOIN_STATE,
      ...parsed,
      step:
        parsed.step === 0 || parsed.step === 1 || parsed.step === 2 || parsed.step === 3
          ? parsed.step
          : 0,
    }
  } catch {
    return INITIAL_JOIN_STATE
  }
}

export function saveJoinDraft(slug: string, state: JoinFormState): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(draftKey(slug), JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
}

export function clearJoinDraft(slug: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(draftKey(slug))
  } catch {
    // Ignore
  }
}

export function validateStep(step: JoinStep, state: JoinFormState): Record<string, string> {
  const errors: Record<string, string> = {}

  if (step === 0) {
    if (!state.full_name.trim()) {
      errors.full_name = 'Enter your full name'
    }
    if (!/^[6-9][0-9]{9}$/.test(state.phone.trim())) {
      errors.phone = 'Enter a valid 10-digit mobile number starting with 6–9'
    }
    if (state.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) {
      errors.email = 'Enter a valid email address'
    }
    if (!state.permanent_address.trim()) {
      errors.permanent_address = 'Enter your permanent address'
    }
  } else if (step === 1) {
    if (!state.emergency_contact_name.trim()) {
      errors.emergency_contact_name = 'Enter emergency contact name'
    }
    if (!/^[0-9+ ]{10,15}$/.test(state.emergency_contact_phone.trim())) {
      errors.emergency_contact_phone = 'Enter a valid 10-digit phone number'
    }
  } else if (step === 2) {
    if (!state.id_doc_number.trim()) {
      errors.id_doc_number = 'Enter your ID number'
    }
    if (!state.id_doc_path) {
      errors.id_doc_path = 'Upload a photo of your ID'
    }
    if (!state.selfie_path) {
      errors.selfie_path = 'Take a live selfie'
    }
    if (state.is_foreign_national) {
      if (!state.passport_number.trim()) {
        errors.passport_number = 'Passport number is required for foreign nationals'
      }
      if (!state.visa_number.trim()) {
        errors.visa_number = 'Visa number is required for foreign nationals'
      }
      if (!state.visa_expiry.trim()) {
        errors.visa_expiry = 'Visa expiry date is required for foreign nationals'
      }
    }
  } else if (step === 3) {
    if (!state.accepted_rules) {
      errors.accepted_rules = 'Please accept the house rules and exit deduction'
    }
  }

  return errors
}

export function buildSubmitPayload(
  state: JoinFormState,
  acceptedExitDeductionPaise: number,
): OnboardingSubmit {
  return {
    full_name: state.full_name.trim(),
    phone: state.phone.trim(),
    email: state.email.trim() || null,
    date_of_birth: state.date_of_birth.trim() || null,
    permanent_address: state.permanent_address.trim(),
    occupation: state.occupation,
    employer_or_college: state.employer_or_college.trim() || null,
    emergency_contact_name: state.emergency_contact_name.trim(),
    emergency_contact_phone: state.emergency_contact_phone.trim(),
    id_doc_type: state.id_doc_type,
    id_doc_number: state.id_doc_number.trim(),
    id_doc_path: state.id_doc_path,
    selfie_path: state.selfie_path,
    is_foreign_national: state.is_foreign_national,
    passport_number: state.is_foreign_national ? state.passport_number.trim() || null : null,
    visa_number: state.is_foreign_national ? state.visa_number.trim() || null : null,
    visa_expiry: state.is_foreign_national ? state.visa_expiry.trim() || null : null,
    accepted_rules: true,
    accepted_exit_deduction_paise: acceptedExitDeductionPaise,
  }
}
