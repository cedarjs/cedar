import { Link } from '@cedarjs/router'
import { Metadata } from '@cedarjs/web'

import { useAuth } from 'src/auth'

/**
 * Lists the signed-in user's organizations, from the memberships
 * `getCurrentUser` returns. Outside `OrgScope`, so it needs no organization.
 */
const OrganizationsPage = () => {
  const { currentUser } = useAuth()

  return (
    <>
      <Metadata title="Organizations" />
      <h1>Your organizations</h1>
      <ul>
        {currentUser?.memberships.map((membership) => (
          <li key={membership.id}>
            <Link to={`/org/${membership.organization.slug}`}>
              {membership.organization.name}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export default OrganizationsPage
