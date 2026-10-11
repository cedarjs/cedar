import ScaffoldLayout from '../ScaffoldLayout/ScaffoldLayout'

type UserExamplesScaffoldLayoutProps = {
  children: React.ReactNode
}

function UserExamplesScaffoldLayout({
  children,
}: UserExamplesScaffoldLayoutProps) {
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
