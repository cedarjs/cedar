// Test module for cedarjsDirectoryNamedImportPlugin functionality
// This module tests directory-based named imports that require the plugin

// This import should fail without the directory named import plugin
// because it's trying to import directly from the directory name
import userService from 'src/services/userService'
import postService from 'src/services/postService'

export const testDirectoryNamedImports = async () => {
  const results = {
    hasUserService: typeof userService !== 'undefined',
    hasPostService: typeof postService !== 'undefined',
    userServiceType: typeof userService,
    postServiceType: typeof postService
  }

  // Test that we can access functions from the imported services
  if (userService && typeof userService.getUserById === 'function') {
    results.canCallUserService = true
    results.userServiceName = userService.userServiceName
  }

  if (postService && typeof postService.getPostById === 'function') {
    results.canCallPostService = true
    results.postServiceName = postService.postServiceName
  }

  return results
}

export const importedModules = {
  userService,
  postService
}

export default {
  testDirectoryNamedImports,
  importedModules
}
