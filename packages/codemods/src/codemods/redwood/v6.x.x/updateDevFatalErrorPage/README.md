# Update Development Fatal Error Page

Changes from a conditional `require` to a regular `import`. The `import` is
then removed by Babel unless we're building for development

Here's a diff of what this codemod will do

```diff
 // still render a generic error page, but your users will prefer something a bit more
 // thoughtful. =)

-// Ensures that production builds do not include the error page
-let CedarDevFatalErrorPage = undefined
-if (process.env.NODE_ENV === 'development') {
-  CedarDevFatalErrorPage =
-    require('@cedarjs/web/dist/components/DevFatalErrorPage').DevFatalErrorPage
-}
+// This import will be automatically removed when building for production
+import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'

-export default CedarDevFatalErrorPage ||
+export default DevFatalErrorPage ||
   (() => (
     <main>
       <style
```
