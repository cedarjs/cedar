import type {
  MailUtilities,
  MailRenderedContent,
  MailRendererOptions,
} from './types.js'

export abstract class AbstractMailRenderer {
  // Render a template
  //
  // May be async. React Email's `render` has been asynchronous since v3 —
  // components like `<Tailwind>` suspend while they compute their styles, so
  // they cannot be rendered synchronously at all.
  abstract render(
    template: unknown,
    options: MailRendererOptions<unknown>,
    utilities?: MailUtilities,
  ): MailRenderedContent | Promise<MailRenderedContent>

  // Provide access to handler specific properties
  abstract internal(): Record<string, unknown>
}
