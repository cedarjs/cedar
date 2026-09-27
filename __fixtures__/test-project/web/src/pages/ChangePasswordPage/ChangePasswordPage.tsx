import { useEffect, useRef } from 'react'

import { Form, Label, PasswordField, Submit, FieldError } from '@cedarjs/forms'
import { navigate, routes } from '@cedarjs/router'
import { Metadata } from '@cedarjs/web'
import { toast, Toaster } from '@cedarjs/web/toast'

import { useAuth } from 'src/auth'

const ChangePasswordPage = () => {
  const { loading, isAuthenticated, reauthenticate, changePassword } = useAuth()

  // Only a logged in user can change their password
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate(routes.login())
    }
  }, [loading, isAuthenticated])

  const currentPasswordRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    currentPasswordRef.current?.focus()
  }, [])

  const onSubmit = async (data: Record<string, string>) => {
    const response = await changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
    })

    if (response.error) {
      toast.error(response.error)
    } else {
      // The function `changePassword.handler` in api/src/functions/auth.js
      // decides if the user stays logged in. `reauthenticate()` picks up
      // whichever it was
      toast.success('Password changed!')
      await reauthenticate()
      navigate(routes.home())
    }
  }

  return (
    <>
      <Metadata title="Change Password" />

      <main className="rw-main">
        <Toaster toastOptions={{ className: 'rw-toast', duration: 6000 }} />
        <div className="rw-scaffold rw-login-container">
          <div className="rw-segment">
            <header className="rw-segment-header">
              <h2 className="rw-heading rw-heading-secondary">
                Change Password
              </h2>
            </header>

            <div className="rw-segment-main">
              <div className="rw-form-wrapper">
                <Form onSubmit={onSubmit} className="rw-form-wrapper">
                  <Label
                    name="currentPassword"
                    className="rw-label"
                    errorClassName="rw-label rw-label-error"
                  >
                    Current Password
                  </Label>
                  <PasswordField
                    name="currentPassword"
                    autoComplete="current-password"
                    className="rw-input"
                    errorClassName="rw-input rw-input-error"
                    ref={currentPasswordRef}
                    validation={{
                      required: {
                        value: true,
                        message: 'Current Password is required',
                      },
                    }}
                  />

                  <FieldError
                    name="currentPassword"
                    className="rw-field-error"
                  />

                  <Label
                    name="newPassword"
                    className="rw-label"
                    errorClassName="rw-label rw-label-error"
                  >
                    New Password
                  </Label>
                  <PasswordField
                    name="newPassword"
                    autoComplete="new-password"
                    className="rw-input"
                    errorClassName="rw-input rw-input-error"
                    validation={{
                      required: {
                        value: true,
                        message: 'New Password is required',
                      },
                    }}
                  />

                  <FieldError name="newPassword" className="rw-field-error" />

                  <div className="rw-button-group">
                    <Submit className="rw-button rw-button-blue">Submit</Submit>
                  </div>
                </Form>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}

export default ChangePasswordPage
