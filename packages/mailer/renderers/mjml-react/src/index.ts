import { renderToMjml } from '@faire/mjml-react/utils/renderToMjml.js'
import mjml2html from 'mjml'

import type {
  MailRenderedContent,
  MailUtilities,
  MailRendererOptions,
} from '@cedarjs/mailer-core'
import { AbstractMailRenderer } from '@cedarjs/mailer-core'

export type SupportedOutputFormats = 'html'
export type RendererOptions = MailRendererOptions<SupportedOutputFormats> &
  Parameters<typeof mjml2html>[1]

export class MJMLReactRenderer extends AbstractMailRenderer {
  async render(
    template: Parameters<typeof renderToMjml>[0],
    options: RendererOptions,
    _utilities?: MailUtilities,
  ): Promise<MailRenderedContent> {
    const renderingResult = mjml2html(renderToMjml(template), options)
    if (renderingResult.errors.length > 0) {
      throw new Error(renderingResult.errors.join('\n'))
    }
    return { html: renderingResult.html, text: '' }
  }

  // Nothing interal to expose
  internal(): Record<string, unknown> {
    return {}
  }
}
