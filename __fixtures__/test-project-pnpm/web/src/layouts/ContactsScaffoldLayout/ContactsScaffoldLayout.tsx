import type { WrapperProps } from '@cedarjs/router'

import ScaffoldLayout from 'src/layouts/ScaffoldLayout'

function ContactsScaffoldLayout({ children }: WrapperProps) {
  return (
    <ScaffoldLayout
      title="Contacts"
      titleTo="contacts"
      buttonLabel="New Contact"
      buttonTo="newContact"
    >
      {children}
    </ScaffoldLayout>
  )
}

export default ContactsScaffoldLayout
