import { useAuth } from 'src/auth'

/** Shown to users who may delete contacts: `useAuth().hasPermission()` */
const AdminNotice = () => {
  const { hasPermission } = useAuth()

  return hasPermission('contacts.delete') ? (
    <p>You may delete contacts</p>
  ) : null
}

export default AdminNotice
