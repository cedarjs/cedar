import type { Meta, StoryObj } from '@storybook/react-vite'

import NavigationLayout from './NavigationLayout'

const meta: Meta<typeof NavigationLayout> = {
  component: NavigationLayout,
}

export default meta

type Story = StoryObj<typeof NavigationLayout>

export const Primary: Story = {}
