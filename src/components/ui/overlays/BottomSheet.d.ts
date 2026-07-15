import * as React from 'react';

/**
 * Hoja inferior modal genérica (bottom sheet). Diálogo accesible: role="dialog",
 * aria-modal, foco gestionado, fondo bloqueado con `inert` mientras está abierta.
 * @startingPoint section="Overlays" subtitle="Hoja inferior genérica (bottom sheet)" viewport="400x600"
 */
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}

export function BottomSheet(props: BottomSheetProps): JSX.Element | null;
