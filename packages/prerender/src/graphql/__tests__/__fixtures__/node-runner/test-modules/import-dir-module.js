// Test module for cedarImportDirPlugin functionality
// This will import multiple files from a directory using glob patterns

import services from 'src/services/**/*.{js,ts}'

export const importedServices = services

export default services
