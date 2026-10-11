import type { Meta, StoryObj } from '@storybook/react'

import BlogPostPage from './BlogPostPage'

const meta: Meta<typeof BlogPostPage> = {
  component: BlogPostPage,
}

export default meta

type Story = StoryObj<typeof BlogPostPage>

export const Primary: Story = {
  render: (args) => {
    return (
      <BlogPostPage id={'4c3d3e8e-2b1a-4f5c-8c7d-000000000042'} {...args} />
    )
  },
}
