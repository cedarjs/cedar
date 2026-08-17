import type {
  MailUtilities,
  MailRenderedContent,
  MailRendererOptions,
} from './types.js'

export abstract class AbstractMailRenderer {
  /**
   * Render a template.
   *
   * May be async. The `<Tailwind>` component for example suspend while it
   * computes it styles, so it cannot be rendered synchronously at all.
   */
  abstract render(
    template: unknown,
    options: MailRendererOptions<unknown>,
    utilities?: MailUtilities,
  ): MailRenderedContent | Promise<MailRenderedContent>

  // Provide access to handler specific properties
  abstract internal(): Record<string, unknown>
}
