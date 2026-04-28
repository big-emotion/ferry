/**
 * Iterator auto-transition. After a successful Iterator commit the ticket
 * returns to `In Review` and `state.iteration` is incremented (FR28). Ferry
 * never self-dispatches the Reviewer — Jira Automation does.
 */

export interface IteratorTransition {
  jira_status: 'In Review';
  add_labels: string[];
  remove_labels: string[];
  next_phase: 'reviewing';
  next_iteration: number;
  self_dispatch: false;
}

export function decideIteratorTransition(input: { current_iteration: number }): IteratorTransition {
  const next = Math.max(0, input.current_iteration) + 1;
  return {
    jira_status: 'In Review',
    add_labels: ['ferry:reviewing'],
    remove_labels: ['ferry:iterating'],
    next_phase: 'reviewing',
    next_iteration: next,
    self_dispatch: false,
  };
}
