import { validateEmail } from '@my-org/validators'
import type { QueryResolvers, MutationResolvers } from 'types/graphql'

// Testing aliased imports with extensions
import { db } from 'src/lib/db.js'

export const contacts: QueryResolvers['contacts'] = () => {
  return db.contact.findMany()
}

export const contact: QueryResolvers['contact'] = ({ id }) => {
  return db.contact.findUnique({
    where: { id },
  })
}

export const createContact: MutationResolvers['createContact'] = ({
  input,
}) => {
  if (!validateEmail(input.email)) {
    throw new Error('Invalid email')
  } else {
    console.log('Creating contact with email:', input.email)
  }

  return db.contact.create({
    data: input,
  })
}

export const updateContact: MutationResolvers['updateContact'] = ({
  id,
  input,
}) => {
  return db.contact.update({
    data: input,
    where: { id },
  })
}

export const deleteContact: MutationResolvers['deleteContact'] = ({ id }) => {
  return db.contact.delete({
    where: { id },
  })
}
