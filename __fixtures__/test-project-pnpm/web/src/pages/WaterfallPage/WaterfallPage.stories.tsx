import type { Meta, StoryObj } from '@storybook/react'

import WaterfallPage from './WaterfallPage'

const meta: Meta<typeof WaterfallPage> = {
  component: WaterfallPage,
}

export default meta

type Story = StoryObj<typeof WaterfallPage>

export const Primary: Story = {
  render: (args) => {
    return (
      <WaterfallPage id={'4c3d3e8e-2b1a-4f5c-8c7d-000000000042'} {...args} />
    )
  },
}
