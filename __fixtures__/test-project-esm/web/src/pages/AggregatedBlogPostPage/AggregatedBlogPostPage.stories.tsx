import type { Meta, StoryObj } from '@storybook/react'

import AggregatedBlogPostPage from './AggregatedBlogPostPage'

const meta: Meta<typeof AggregatedBlogPostPage> = {
  component: AggregatedBlogPostPage,
}

export default meta

type Story = StoryObj<typeof AggregatedBlogPostPage>

export const Primary: Story = {
  render: (args) => {
    return <AggregatedBlogPostPage id={42} {...args} />
  },
}
