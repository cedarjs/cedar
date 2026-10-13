import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'unit-test-schema.prisma',
  datasource: {
    url: 'file:for_unit_test.db',
  },
})
