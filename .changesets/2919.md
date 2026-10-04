- fix(cli): Find the plugins property when inserting Vite plugins during setup
  by @Tobbe

`cedar setup deploy netlify --ud` and `cedar setup deploy vercel --ud` register
their Vite plugins in the `plugins` array of `web/vite.config.ts` even when
other properties, such as `build` or `server`, come before `plugins` in the
config object.
