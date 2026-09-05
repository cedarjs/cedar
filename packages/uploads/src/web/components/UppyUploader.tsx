import { useEffect, useRef } from 'react'

import {
  Dropzone,
  FilesList,
  UploadButton,
  UppyContextProvider,
} from '@uppy/react'

import type { CedarUppy } from '../createUppy.js'

export type UploaderVariant = 'dashboard' | 'drag-drop' | 'file-input'

export interface UppyUploaderProps {
  uppy: CedarUppy | null
  /**
   * `dashboard` mounts the full `@uppy/dashboard` UI. `drag-drop` renders
   * Uppy's headless dropzone with a file list. `file-input` renders a plain
   * upload button. Defaults to `dashboard`.
   */
  variant?: UploaderVariant
  /** Options passed to `@uppy/dashboard` for the `dashboard` variant. */
  dashboardOptions?: Record<string, unknown>
  /** Text shown under the dropzone for the `drag-drop` variant. */
  note?: string
  children?: React.ReactNode
}

function DashboardMount({
  uppy,
  options,
}: {
  uppy: CedarUppy
  options?: Record<string, unknown>
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = ref.current

    if (!target) {
      return
    }

    let cancelled = false

    import('@uppy/dashboard').then(({ default: Dashboard }) => {
      if (cancelled) {
        return
      }

      uppy.use(Dashboard, {
        inline: true,
        target,
        proudlyDisplayPoweredByUppy: false,
        ...options,
      })
    })

    return () => {
      cancelled = true
      const plugin = uppy.getPlugin('Dashboard')

      if (plugin) {
        uppy.removePlugin(plugin)
      }
    }
    // The plugin is mounted once per Uppy instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uppy])

  return <div ref={ref} />
}

/**
 * Renders an Uppy UI for an instance created by `useS3Upload` or
 * `useFsUpload`. Renders nothing until the instance exists.
 */
export function UppyUploader({
  uppy,
  variant = 'dashboard',
  dashboardOptions,
  note,
  children,
}: UppyUploaderProps) {
  if (!uppy) {
    return null
  }

  if (variant === 'dashboard') {
    return <DashboardMount uppy={uppy} options={dashboardOptions} />
  }

  return (
    <UppyContextProvider uppy={uppy}>
      {variant === 'drag-drop' ? (
        <>
          <Dropzone note={note} />
          <FilesList />
        </>
      ) : (
        <UploadButton />
      )}
      {children}
    </UppyContextProvider>
  )
}
