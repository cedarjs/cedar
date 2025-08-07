export const createCell = (config) => {
  const CellComponent = (props) => {
    // Mock cell component that can render different states
    if (props.loading) {
      return config.Loading ? config.Loading(props) : 'Loading...'
    }

    if (props.error) {
      return config.Failure ? config.Failure(props) : 'Error occurred'
    }

    if (!props.data || (config.isEmpty && config.isEmpty(props.data))) {
      return config.Empty ? config.Empty(props) : 'No data'
    }

    return config.Success ? config.Success(props) : 'Success'
  }

  // Add displayName to the component
  CellComponent.displayName = config.displayName

  // Attach all the original exports to the component for testing
  Object.keys(config).forEach(key => {
    if (key !== 'displayName') {
      CellComponent[key] = config[key]
    }
  })

  return CellComponent
}

export const createServerCell = (config) => {
  // Same implementation as createCell for testing purposes
  return createCell(config)
}
