// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { DbInput } from '../web/components/DbInput.js'
import { useDbUpload } from '../web/hooks/useDbUpload.js'

const png = new File([new Uint8Array([1, 2, 3])], 'dot.png', {
  type: 'image/png',
})

describe('useDbUpload', () => {
  test('reads allowed files as base64', async () => {
    const onFileReady = vi.fn()
    const { result } = renderHook(() =>
      useDbUpload({
        allowedMimeTypes: ['image/*'],
        maxFileSize: 10,
        onFileReady,
      }),
    )

    let file: Awaited<ReturnType<typeof result.current.readFile>> | undefined
    await act(async () => {
      file = await result.current.readFile(png)
    })

    expect(file).toEqual({
      filename: 'dot.png',
      mimeType: 'image/png',
      data: 'AQID',
      size: 3,
    })
    expect(onFileReady).toHaveBeenCalledWith(file)
  })

  test('rejects disallowed types, oversized files, and too many files', async () => {
    const { result } = renderHook(() =>
      useDbUpload({
        allowedMimeTypes: ['image/png'],
        maxFileSize: 2,
        maxFiles: 1,
      }),
    )

    await expect(
      result.current.readFile(new File(['x'], 'a.txt', { type: 'text/plain' })),
    ).rejects.toThrow("File type 'text/plain' is not allowed.")
    await expect(result.current.readFile(png)).rejects.toThrow(
      'exceeds the 2 byte limit',
    )
    await expect(result.current.readFiles([png, png])).rejects.toThrow(
      'At most 1 file(s) can be selected.',
    )
  })

  test('tracks progress across a batch', async () => {
    const { result } = renderHook(() =>
      useDbUpload({ allowedMimeTypes: ['image/png'], maxFileSize: 10 }),
    )

    await act(async () => {
      await result.current.readFiles([png, png])
    })

    expect(result.current.progress).toEqual({ completed: 2, total: 2 })
    expect(result.current.isReading).toBe(false)
  })
})

describe('DbInput', () => {
  test('renders a constrained file input and reports files', async () => {
    const onFilesReady = vi.fn()
    const { getByTestId } = render(
      <DbInput
        data-testid="input"
        allowedMimeTypes={['image/png', 'image/jpeg']}
        maxFileSize={10}
        maxFiles={2}
        onFilesReady={onFilesReady}
      />,
    )

    const input = getByTestId('input') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toBe('image/png,image/jpeg')
    expect(input.multiple).toBe(true)

    fireEvent.change(input, { target: { files: [png] } })

    await waitFor(() =>
      expect(onFilesReady).toHaveBeenCalledWith([
        { filename: 'dot.png', mimeType: 'image/png', data: 'AQID', size: 3 },
      ]),
    )
  })

  test('reports validation errors through onReadError', async () => {
    const onReadError = vi.fn()
    const { getByTestId } = render(
      <DbInput
        data-testid="input"
        allowedMimeTypes={['image/png']}
        maxFileSize={1}
        onReadError={onReadError}
      />,
    )

    fireEvent.change(getByTestId('input'), { target: { files: [png] } })

    await waitFor(() =>
      expect(onReadError).toHaveBeenCalledWith(expect.any(Error)),
    )
    expect(onReadError.mock.calls[0][0].message).toContain(
      'exceeds the 1 byte limit',
    )
  })
})
