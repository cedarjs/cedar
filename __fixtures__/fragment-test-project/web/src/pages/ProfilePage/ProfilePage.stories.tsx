import type { Meta, StoryObj } from '@storybook/react-vite'

import ProfilePage from './ProfilePage'

const meta: Meta<typeof ProfilePage> = {
  component: ProfilePage,
}

export default meta

type Story = StoryObj<typeof ProfilePage>

export const Primary: Story = {}
