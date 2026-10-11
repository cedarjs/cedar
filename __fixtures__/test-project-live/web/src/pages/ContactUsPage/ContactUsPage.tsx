import { useState } from 'react'

import { validateEmail } from '@my-org/validators'
import { useForm } from 'react-hook-form'

import {
  Form,
  TextField,
  TextAreaField,
  Submit,
  FieldError,
  Label,
} from '@cedarjs/forms'
import { useBlocker } from '@cedarjs/router'
import { useMutation } from '@cedarjs/web'
import { toast, Toaster } from '@cedarjs/web/toast'

const CREATE_CONTACT = gql`
  mutation CreateContactMutation($input: CreateContactInput!) {
    createContact(input: $input) {
      id
    }
  }
`

const ContactUsPage = () => {
  const formMethods = useForm()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const blocker = useBlocker({
    when: formMethods.formState.isDirty && !isSubmitting,
  })

  const [create, { loading, error }] = useMutation(CREATE_CONTACT, {
    onCompleted: () => {
      toast.success('Thank you for your submission!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const onSubmit = async (data) => {
    setIsSubmitting(true)
    try {
      await create({ variables: { input: data } })
      formMethods.reset(data)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Toaster toastOptions={{ className: 'rw-toast', duration: 6000 }} />
      <Form
        onSubmit={onSubmit}
        formMethods={formMethods}
        config={{ mode: 'onBlur' }}
        error={error}
      >
        {blocker.state === 'BLOCKED' ? (
          <div>
            <button type="button" onClick={() => blocker.confirm()}>
              Confirm
            </button>
            <button type="button" onClick={() => blocker.abort()}>
              Abort
            </button>
          </div>
        ) : null}

        <Label
          name="name"
          className="block text-sm text-gray-700 uppercase"
          errorClassName="block uppercase text-sm text-red-700"
        >
          Name
        </Label>
        <TextField
          name="name"
          validation={{ required: true }}
          className="rounded-xs border px-2 py-1 outline-hidden"
          errorClassName="border rounded-xs px-2 py-1 border-red-700 outline-hidden"
        />
        <FieldError name="name" className="block text-red-700" />

        <Label
          name="email"
          className="mt-8 block text-sm text-gray-700 uppercase"
          errorClassName="block mt-8 text-red-700 uppercase text-sm"
        >
          Email
        </Label>
        <TextField
          name="email"
          validation={{
            required: true,
            validate: (value) => {
              if (!value) {
                return 'Email is required'
              }

              if (!validateEmail(value)) {
                return 'Please enter a valid email address'
              }

              return true
            },
          }}
          className="rounded-xs border px-2 py-1"
          errorClassName="border rounded-xs px-2 py-1 border-red-700 outline-hidden"
        />
        <FieldError name="email" className="block text-red-700" />

        <Label
          name="message"
          className="mt-8 block text-sm text-gray-700 uppercase"
          errorClassName="block mt-8 text-red-700 uppercase text-sm"
        >
          Message
        </Label>
        <TextAreaField
          name="message"
          validation={{ required: true }}
          className="block rounded-xs border px-2 py-1"
          errorClassName="block border rounded-xs px-2 py-1 border-red-700 outline-hidden"
        />
        <FieldError name="message" className="block text-red-700" />

        <Submit
          className="mt-8 block rounded-sm bg-blue-700 px-4 py-2 text-white"
          disabled={loading}
        >
          Save
        </Submit>
      </Form>
    </>
  )
}

export default ContactUsPage
