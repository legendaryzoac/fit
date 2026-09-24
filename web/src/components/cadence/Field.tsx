import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

/** Hides the native number spinner; numeric wells carry their own controls. */
export const NO_SPINNER =
  '[appearance:textfield] [-moz-appearance:textfield] ' +
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 ' +
  '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0'

/** A well while focused: lifts to the surface with an inset brand ring
 * (the ring replaces the page-level focus outline). */
export const WELL_FOCUS =
  'focus:bg-surface focus:[box-shadow:inset_0_0_0_1.5px_var(--brand)] focus-visible:outline-none'

const WELL =
  'motion-quick w-full min-h-11 rounded-sm bg-surface-2 px-3.5 text-body text-ink ' +
  `placeholder:text-ink-4 transition-[background-color,box-shadow] hover:bg-surface-3 ${WELL_FOCUS}`

/** A labelled control: caption label above, help (or an error) below. */
export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  help?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-caption font-semibold text-ink-2"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-caption text-rose-strong">{error}</p>
      ) : (
        help && <p className="text-caption text-ink-3">{help}</p>
      )}
    </div>
  )
}

export function TextInput({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${WELL} ${className}`} {...rest} />
}

export function TextArea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={`${WELL} min-h-22 resize-y py-3 ${className}`} {...rest} />
  )
}
