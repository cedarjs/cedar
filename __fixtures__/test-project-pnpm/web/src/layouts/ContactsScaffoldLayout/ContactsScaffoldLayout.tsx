import ScaffoldLayout from 'src/layouts/ScaffoldLayout'

type ContactsScaffoldLayoutProps = {
  children: React.ReactNode
}

function ContactsScaffoldLayout({ children }: ContactsScaffoldLayoutProps) {
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
