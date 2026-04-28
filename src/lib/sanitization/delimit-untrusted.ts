/**
 * Story 3-1 NFR-S1: wrap untrusted strings before sending them into an LLM prompt.
 *
 * The fence tokens are deliberate, distinctive, and escaped if they already appear
 * in the input — the LLM cannot "close" the fence early to inject instructions.
 */

const OPEN = '<<<UNTRUSTED>>>';
const CLOSE = '<<<END UNTRUSTED>>>';
const OPEN_ESCAPE = '<<<UNTRUSTED-LITERAL>>>';
const CLOSE_ESCAPE = '<<<END UNTRUSTED-LITERAL>>>';

export function delimitUntrusted(value: string): string {
  const escaped = value.split(OPEN).join(OPEN_ESCAPE).split(CLOSE).join(CLOSE_ESCAPE);
  return `${OPEN}\n${escaped}\n${CLOSE}`;
}
