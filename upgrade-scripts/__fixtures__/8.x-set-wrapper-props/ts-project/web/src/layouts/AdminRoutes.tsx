import { Route, Set } from '@cedarjs/router'

import AdminLayout from 'src/layouts/AdminLayout'

export const adminRoutes = (
  <Set wrap={AdminLayout} level={2}>
    <Route path="/admin/users" page={UsersPage} name="users" />
  </Set>
)

const layoutProps = { level: 3 }

export const reportRoutes = (
  <Set wrap={AdminLayout} {...layoutProps}>
    <Route path="/admin/reports" page={ReportsPage} name="reports" />
  </Set>
)
