/** Escapes HTML characters to prevent XSS attacks */
export function escape(string: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }

  return string.replace(/[&<>"']/g, (char) => htmlEscapes[char])
}
