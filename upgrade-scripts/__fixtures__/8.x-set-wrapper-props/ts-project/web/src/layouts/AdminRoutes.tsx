import { Route, Set } from '@cedarjs/router'

import AdminLayout from 'src/layouts/AdminLayout'

export const adminRoutes = (
  <Set wrap={AdminLayout} level={2}>
    <Route path="/admin/users" page={UsersPage} name="users" />
  </Set>
)
