import { render as reactEmailRender } from '@react-email/render'

import type {
  MailRenderedContent,
  MailUtilities,
  MailRendererOptions,
} from '@cedarjs/mailer-core'
import { AbstractMailRenderer } from '@cedarjs/mailer-core'

export type SupportedOutputFormats = 'both' | 'html' | 'text'
export type RendererOptions = MailRendererOptions<SupportedOutputFormats> &
  Parameters<typeof reactEmailRender>[1]

export class ReactEmailRenderer extends AbstractMailRenderer {
  async render(
    template: Parameters<typeof reactEmailRender>[0],
    options: RendererOptions,
    _utilities?: MailUtilities,
  ): Promise<MailRenderedContent> {
    // `plainText` is set after spreading `options` because it is what
    // distinguishes the two passes below — the html/text split is driven by
    // `outputFormat`, so letting a caller override it would just break one of
    // the two outputs.
    const outputFormat = options.outputFormat ?? 'both'
    const renderHTML = outputFormat === 'both' || outputFormat === 'html'
    const renderText = outputFormat === 'both' || outputFormat === 'text'
    return {
      html: renderHTML
        ? await reactEmailRender(template, {
            pretty: true,
            ...options,
            plainText: false,
          })
        : '',
      text: renderText
        ? await reactEmailRender(template, {
            pretty: true,
            ...options,
            plainText: true,
          })
        : '',
    }
  }

  // Nothing interal to expose
  internal(): Record<string, unknown> {
    return {}
  }
}
