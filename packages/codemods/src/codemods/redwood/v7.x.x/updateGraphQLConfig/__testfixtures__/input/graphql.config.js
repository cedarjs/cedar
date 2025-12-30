const { getPaths } = require('@cedarjs/internal')

module.exports = {
  schema: getPaths().generated.schema,
}
