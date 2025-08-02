// Index file for services directory
// This enables named imports like: import { userService } from 'src/services'

export { default as userService } from './userService.js'
export { default as postService } from './postService.ts'

// Re-export all named exports from individual service files
export * from './userService.js'
export * from './postService.ts'
