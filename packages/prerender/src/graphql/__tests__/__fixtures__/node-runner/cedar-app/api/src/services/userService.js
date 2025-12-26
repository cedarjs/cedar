// Sample user service for testing directory imports

export const getUserById = async (id) => {
  return {
    id,
    name: 'Test User',
    email: 'test@example.com'
  }
}

export const createUser = async (userData) => {
  return {
    id: Math.random().toString(36),
    ...userData
  }
}

export const userServiceName = 'userService'

export default {
  getUserById,
  createUser,
  userServiceName
}
