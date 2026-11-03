import { useState } from 'react'

import type {
  TenancyE2eInviteMemberMutation,
  TenancyE2eInviteMemberMutationVariables,
  TenancyE2eOrganizationQuery,
  TenancyE2eOrganizationQueryVariables,
} from 'types/graphql'

import { useCurrentOrg } from '@cedarjs/tenancy/web'
import { Metadata, useMutation, useQuery } from '@cedarjs/web'
import type { TypedDocumentNode } from '@cedarjs/web'

import { useAuth } from 'src/auth'

const ORGANIZATION_QUERY: TypedDocumentNode<
  TenancyE2eOrganizationQuery,
  TenancyE2eOrganizationQueryVariables
> = gql`
  query TenancyE2eOrganizationQuery($id: String!) {
    organization(id: $id) {
      id
      name
    }
  }
`

const INVITE_MEMBER_MUTATION: TypedDocumentNode<
  TenancyE2eInviteMemberMutation,
  TenancyE2eInviteMemberMutationVariables
> = gql`
  mutation TenancyE2eInviteMemberMutation($input: InviteMemberInput!) {
    inviteMember(input: $input) {
      invitationToken
    }
  }
`

/**
 * An organization's page, in a `PrivateSet`. Its name comes from the api
 * (`@requirePermission(permission: "organization.read")`), so it shows the
 * request went out for this organization, and the invite form shows only
 * when `useAuth().hasPermission('members.manage')`.
 */
const OrganizationPage = () => {
  const { org } = useCurrentOrg()
  const { hasPermission } = useAuth()
  const [email, setEmail] = useState('')

  const { data, error } = useQuery(ORGANIZATION_QUERY, {
    variables: { id: org?.id ?? '' },
    skip: !org,
  })
  const [inviteMember, { data: invitation }] = useMutation(
    INVITE_MEMBER_MUTATION,
  )

  const canManageMembers = hasPermission('members.manage')

  return (
    <>
      <Metadata title="Organization" />
      <h1>{data?.organization?.name ?? error?.message ?? 'Loading…'}</h1>
      <p>Role: {org?.role}</p>
      <p>Can manage members: {canManageMembers ? 'yes' : 'no'}</p>
      {canManageMembers && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            inviteMember({ variables: { input: { email, role: 'member' } } })
          }}
        >
          <label>
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button type="submit">Invite</button>
        </form>
      )}
      {invitation && (
        <a href={`/invite/${invitation.inviteMember.invitationToken}`}>
          Invitation link
        </a>
      )}
    </>
  )
}

export default OrganizationPage
