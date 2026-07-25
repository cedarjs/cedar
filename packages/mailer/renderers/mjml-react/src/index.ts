// Under CJS the extensionless subpath import resolved fine, but Node16/
// NodeNext module resolution (which kicks in now that this package is
// "type": "module") requires an explicit file extension for subpath imports.
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
  render(
    template: Parameters<typeof renderToMjml>[0],
    options: RendererOptions,
    _utilities?: MailUtilities,
  ): MailRenderedContent {
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
