/**
 * Reviewer auto-transition.
 *
 * Maps the reviewer decision to the next Jira status, ferry labels, and
 * phase. Ferry never self-dispatches the Iterator — Jira Automation fires on
 * the column move and emits the next repository_dispatch (FR40).
 */

import type { ReviewerDecision } from './verdict.js';

export interface ReviewerTransition {
  jira_status?: string;
  add_labels: string[];
  remove_labels: string[];
  next_phase: 'ready' | 'iterating' | 'escalated';
  /** Always false; Ferry must not self-trigger downstream phases. */
  self_dispatch: false;
}

export function decideReviewerTransition(input: {
  decision: ReviewerDecision;
}): ReviewerTransition {
  switch (input.decision) {
    case 'merge-ready':
      return {
        jira_status: 'Ready to Merge',
        add_labels: ['ferry:ready'],
        remove_labels: ['ferry:reviewing'],
        next_phase: 'ready',
        self_dispatch: false,
      };
    case 'changes-requested':
      return {
        jira_status: 'Changes Requested',
        add_labels: [],
        remove_labels: ['ferry:reviewing'],
        next_phase: 'iterating',
        self_dispatch: false,
      };
    case 'needs-human':
      return {
        add_labels: ['needs-human'],
        remove_labels: ['ferry:reviewing'],
        next_phase: 'escalated',
        self_dispatch: false,
      };
  }
}
