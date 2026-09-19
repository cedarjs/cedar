import React from 'react'

import { get, useFormContext } from 'react-hook-form'
import type {
  FieldError as HookFormFieldError,
  ValidateResult,
} from 'react-hook-form'

export interface FieldErrorRenderProps {
  /**
   * The error message. When the failed validation rule has no message of its
   * own this is the default message for the error's `type`.
   */
  message: string
  /**
   * The message of every failed validation rule, keyed by rule. Only set when
   * the form collects all errors: `<Form config={{ criteriaMode: 'all' }}>`.
   */
  messages?: Record<string, string | string[]>
  /**
   * What caused the error: the name of the validation rule (`required`,
   * `minLength`, ...), the key of the failing function in a `validate`
   * object, `server` for errors from the API side, or whatever `type`
   * `setError` was called with.
   */
  type?: string | number
}

export interface FieldErrorProps extends React.ComponentPropsWithoutRef<'span'> {
  /**
   * The name of the field the `<FieldError>`'s associated with.
   * Use `root.<key>` for a form-level error set with
   * `setError('root.<key>', ...)`.
   */
  name: string
  /**
   * Render something other than a `<span>` with the message in it. Only
   * called when there's an error.
   */
  render?: (props: FieldErrorRenderProps) => React.ReactNode
}

const DEFAULT_MESSAGES = {
  required: 'is required',
  pattern: 'is not formatted correctly',
  minLength: 'is too short',
  maxLength: 'is too long',
  min: 'is too low',
  max: 'is too high',
  validate: 'is not valid',
}

/**
 * Renders a `<span>` with an error message if there's a validation error on the corresponding field.
 * If no error message is provided, a default one is used based on the type of validation that caused the error.
 *
 * @example Displaying a validation error message with `<FieldError>`
 *
 * `<FieldError>` doesn't render (i.e. returns `null`) when there's no error on `<TextField>`.
 *
 * ```jsx
 * <Label name="name" errorClassName="error">
 *   Name
 * </Label>
 * <TextField
 *   name="name"
 *   validation={{ required: true }}
 *   errorClassName="error"
 * />
 * <FieldError name="name" className="error" />
 * ```
 *
 * @example Rendering every failed rule's message with `render`
 *
 * ```jsx
 * <Form config={{ criteriaMode: 'all' }}>
 *   <FieldError
 *     name="password"
 *     render={({ messages }) => (
 *       <ul>
 *         {Object.entries(messages).map(([type, message]) => (
 *           <li key={type}>{message}</li>
 *         ))}
 *       </ul>
 *     )}
 *   />
 * ```
 *
 * @see {@link https://cedarjs.com/docs/tutorial/chapter3/forms#fielderror}
 *
 * @privateRemarks
 *
 * This is basically a helper for a common pattern you see in `react-hook-form`:
 *
 * ```jsx
 * <form onSubmit={handleSubmit(onSubmit)}>
 *   <input {...register("firstName", { required: true })} />
 *   {errors.firstName?.type === 'required' && "First name is required"}
 * ```
 *
 * @see {@link https://react-hook-form.com/get-started#Handleerrors}
 */
export const FieldError = ({ name, render, ...rest }: FieldErrorProps) => {
  const {
    formState: { errors },
  } = useFormContext()

  const validationError: HookFormFieldError | undefined = get(errors, name)

  if (!validationError) {
    return null
  }

  // Form-level errors live under `root`. They don't belong to a field, so
  // there's no sensible "<name> is ..." default message for them.
  const isRootError = name === 'root' || name.startsWith('root.')
  const defaultMessages: Record<string, string> = DEFAULT_MESSAGES

  const getDefaultMessage = (type?: string | number) => {
    if (isRootError) {
      return ''
    }

    // Errors from a `validate` object have the failing function's key as their
    // type, and `setError` accepts any type, so not every type has an entry
    return `${name} ${defaultMessages[String(type)] ?? DEFAULT_MESSAGES.validate}`
  }

  const message =
    validationError.message || getDefaultMessage(validationError.type)

  if (render) {
    // In `types`, a rule that failed without a message of its own is `true`
    const toMessage = (type: string, result: ValidateResult) => {
      if (Array.isArray(result) || (typeof result === 'string' && result)) {
        return result
      }

      return getDefaultMessage(type)
    }

    const messages =
      validationError.types &&
      Object.fromEntries(
        Object.entries(validationError.types).map(
          ([type, result]): [string, string | string[]] => [
            type,
            toMessage(type, result),
          ],
        ),
      )

    return render({ message, messages, type: validationError.type })
  }

  return message ? <span {...rest}>{message}</span> : null
}
