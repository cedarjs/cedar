import type { Meta, StoryObj } from '@storybook/react-vite'

import GroceriesPage from './GroceriesPage'

const meta: Meta<typeof GroceriesPage> = {
  component: GroceriesPage,
}

export default meta

type Story = StoryObj<typeof GroceriesPage>

export const Primary: Story = {}
