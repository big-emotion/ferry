export interface AdfTextNode {
  type: 'text';
  text: string;
}

export interface AdfHardBreakNode {
  type: 'hardBreak';
}

export type AdfInlineNode = AdfTextNode | AdfHardBreakNode;

export interface AdfParagraphNode {
  type: 'paragraph';
  content: AdfInlineNode[];
}

export interface AdfDoc {
  version: 1;
  type: 'doc';
  content: AdfParagraphNode[];
}

/**
 * Convert plain text to minimal ADF. Splits on `\n\n` for paragraphs;
 * inline `\n` within a paragraph becomes a hardBreak node.
 */
export function textToAdf(text: string): AdfDoc {
  const paragraphs = text.split('\n\n').filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
    };
  }

  const content: AdfParagraphNode[] = paragraphs.map((para) => {
    const lines = para.split('\n');
    const paraContent: AdfInlineNode[] = [];

    lines.forEach((line, i) => {
      if (i > 0) paraContent.push({ type: 'hardBreak' });
      if (line.length > 0) paraContent.push({ type: 'text', text: line });
    });

    return { type: 'paragraph', content: paraContent };
  });

  return { version: 1, type: 'doc', content };
}

/**
 * Extract plain text from an ADF doc for string-search operations (e.g. idempotency marker lookup).
 * Paragraphs are joined with `\n\n`; hardBreak nodes become `\n`.
 */
export function adfToText(adf: AdfDoc | null | undefined): string {
  if (!adf || !Array.isArray(adf.content)) return '';

  return adf.content
    .map((para) => {
      if (!Array.isArray(para.content)) return '';
      return para.content.map((node) => (node.type === 'text' ? node.text : '\n')).join('');
    })
    .join('\n\n');
}
