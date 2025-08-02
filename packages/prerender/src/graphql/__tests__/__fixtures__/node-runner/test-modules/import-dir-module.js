// Test module for cedarImportDirPlugin functionality
// This will import multiple files from a directory using glob patterns

import services from 'src/services/**/*.{js,ts}'

export const importedServices = services
export const serviceCount = Object.keys(services).length
export const serviceNames = Object.keys(services)

export default services
