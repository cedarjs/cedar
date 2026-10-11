import type { WrapperProps } from '@cedarjs/router'

import ScaffoldLayout from '../ScaffoldLayout/ScaffoldLayout'

function UserExamplesScaffoldLayout({ children }: WrapperProps) {
  return (
    <ScaffoldLayout
      title="UserExamples"
      titleTo="userExamples"
      buttonLabel="New UserExample"
      buttonTo="newUserExample"
    >
      {children}
    </ScaffoldLayout>
  )
}

export default UserExamplesScaffoldLayout
