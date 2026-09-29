export type StepType = 'premise' | 'derivation' | 'goal';
export type CheckSeverity = 'error' | 'warning' | 'info';
export type ReviewStatus = 'pending' | 'approved' | 'hold';

export interface StepReview {
  status: ReviewStatus;
  comment: string;
  reviewer: string;
  reviewedAt: string;
  /** 通过后内容被再次编辑而自动退回待改的时间点。 */
  returnedAt: string;
}

export interface ProofStep {
  id: string;
  type: StepType;
  statement: string;
  rule: string;
  references: string[];
  note: string;
  counterexample: string;
  alternative: string;
  review: StepReview;
}

export interface ProofVersion {
  id: string;
  name: string;
  createdAt: string;
  steps: ProofStep[];
  goal: string;
}

export interface ProofDocument {
  id: string;
  title: string;
  author: string;
  goal: string;
  symbols: Record<string, string>;
  steps: ProofStep[];
  versions: ProofVersion[];
  updatedAt: string;
}

export interface ProofCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  stepId?: string;
}

export interface ReviewSummary {
  total: number;
  pending: number;
  approved: number;
  hold: number;
  /** 全部步骤均通过审阅，且没有结构错误时，证明可以定稿。 */
  finalizable: boolean;
}

export interface ProofDiff {
  kind: 'same' | 'added' | 'removed' | 'changed';
  label: string;
  before: string;
  after: string;
  beforeId?: string;
  afterId?: string;
  reviewChanged: boolean;
  beforeReview?: StepReview;
  afterReview?: StepReview;
}
