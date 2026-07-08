import * as React from 'react';

export type PipelineState =
  | 'lead' | 'talking' | 'proposal' | 'negotiating' | 'won' | 'lost' | 'inactive';

/**
 * Sales-pipeline status pill (7 canonical states). The defining component of the CRM.
 * @startingPoint section="Feedback" subtitle="Badge de estado del pipeline (7 estados)" viewport="700x150"
 */
export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  state?: PipelineState;
  /** Override the default Spanish label. */
  label?: string | null;
  dot?: boolean;
  style?: React.CSSProperties;
}

export declare const PIPELINE_STATES: Record<PipelineState, {
  label: string; bg: string; fg: string; dot: string;
}>;

export function StatusBadge(props: StatusBadgeProps): JSX.Element;
