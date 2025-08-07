// Test module for cedarImportDirPlugin functionality
// This will import multiple files from a directory using glob patterns

// This should expand to (basically) this:
// const services = {}
// services.post_post = import('src/services/post/post')
// services.userService = import('src/services/userService')
import services from 'src/services/**/*.{js,ts}'

export const importedServices = services
