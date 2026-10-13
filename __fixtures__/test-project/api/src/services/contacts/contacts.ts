import { validateEmail } from '@my-org/validators'
import type { QueryResolvers, MutationResolvers } from 'types/graphql'

import { ServiceValidationError } from '@cedarjs/api'

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
    throw new ServiceValidationError('Invalid email >' + input.email + '<')
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
    data: {
      ...input,
      // Every field in the GraphQL input is nullable, but Prisma doesn't
      // accept null for required fields. undefined leaves the field unchanged
      name: input.name ?? undefined,
      email: input.email ?? undefined,
      message: input.message ?? undefined,
    },
    where: { id },
  })
}

export const deleteContact: MutationResolvers['deleteContact'] = ({ id }) => {
  return db.contact.delete({
    where: { id },
  })
}
