import type { Meta, StoryObj } from '@storybook/react'

import GqlormTodosPage from './GqlormTodosPage'

const meta: Meta<typeof GqlormTodosPage> = {
  component: GqlormTodosPage,
}

export default meta

type Story = StoryObj<typeof GqlormTodosPage>

export const Primary: Story = {}
