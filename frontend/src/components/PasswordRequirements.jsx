import { Check, Circle } from 'lucide-react'
import { getPasswordPolicy, MIN_PASSWORD_LENGTH } from '../utils/passwordPolicy'

export default function PasswordRequirements({ id, password }) {
  const { checks } = getPasswordPolicy(password)
  const rules = [
    { met: checks.length, label: `At least ${MIN_PASSWORD_LENGTH} characters` },
    { met: checks.notCommon, label: 'Avoid common passwords and repeated patterns' }
  ]

  return (
    <div id={id} className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--color-primary-active)]">
      <ul className="space-y-1" aria-label="Password requirements">
        {rules.map(({ met, label }) => (
          <li key={label} className={`flex items-start gap-2 ${met ? 'text-emerald-700' : ''}`}>
            {met ? <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <Circle aria-hidden="true" className="mt-1 h-3 w-3 shrink-0" />}
            <span><span className="sr-only">{password ? met ? 'Met: ' : 'Not met: ' : 'Required: '}</span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
