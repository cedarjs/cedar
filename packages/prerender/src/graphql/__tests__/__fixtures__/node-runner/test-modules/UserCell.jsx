import { useState, useEffect } from 'react'

export const QUERY = gql`
  query FindUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      createdAt
    }
  }
`

export const Loading = () => <div>Loading user...</div>

export const Empty = () => <div>No user found</div>

export const Failure = ({ error }) => (
  <div role="alert">
    <h2>Error loading user</h2>
    <pre>{error.message}</pre>
  </div>
)

export const Success = ({ user }) => {
  const [displayUser, setDisplayUser] = useState(user)

  useEffect(() => {
    setDisplayUser(user)
  }, [user])

  return (
    <div className="user-cell">
      <h1>User Profile</h1>
      <div className="user-details">
        <p><strong>ID:</strong> {displayUser.id}</p>
        <p><strong>Name:</strong> {displayUser.name}</p>
        <p><strong>Email:</strong> {displayUser.email}</p>
        <p><strong>Created:</strong> {new Date(displayUser.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  )
}

// This export will be transformed by cedarCellTransform
export default Success
