import { contacts } from 'api/src/services/contacts/contacts'

export default async () => {
  const _allContacts = await contacts()
  console.log('Hello from myNestedScript.ts')
}
