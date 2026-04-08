import type { Meta, StoryObj } from '@storybook/react'

import LiveQueryPage from './LiveQueryPage'

const meta: Meta<typeof LiveQueryPage> = {
  component: LiveQueryPage,
}

export default meta

type Story = StoryObj<typeof LiveQueryPage>

export const Primary: Story = {}
