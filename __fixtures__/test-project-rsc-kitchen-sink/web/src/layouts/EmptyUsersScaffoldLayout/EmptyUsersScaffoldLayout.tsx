import type { WrapperProps } from '@cedarjs/router'

import ScaffoldLayout from '../ScaffoldLayout/ScaffoldLayout'

function EmptyUsersScaffoldLayout({ children }: WrapperProps) {
  return (
    <ScaffoldLayout
      title="EmptyUsers"
      titleTo="emptyUsers"
      buttonLabel="New EmptyUser"
      buttonTo="newEmptyUser"
    >
      {children}
    </ScaffoldLayout>
  )
}

export default EmptyUsersScaffoldLayout
