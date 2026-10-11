import ScaffoldLayout from '../ScaffoldLayout/ScaffoldLayout'

type EmptyUsersScaffoldLayoutProps = {
  children: React.ReactNode
}

const EmptyUsersScaffoldLayout = ({
  children,
}: EmptyUsersScaffoldLayoutProps) => {
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
