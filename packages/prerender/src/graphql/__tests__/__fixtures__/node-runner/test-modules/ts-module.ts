export interface User {
  id: string
  name: string
}

export const createUser = (name: string): User => ({
  id: Math.random().toString(),
  name
})

export default 'typescript-default'
