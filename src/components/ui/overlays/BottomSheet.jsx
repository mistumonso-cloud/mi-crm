"use client";

import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Hoja inferior genérica (bottom sheet), accesible como diálogo modal
 * (role="dialog", aria-modal, gestión de foco, fondo bloqueado con `inert`
 * mientras está abierta). El cuerpo (children) es libre a propósito: los
 * tickets de cada acción (MIS-11/12/14/15) sustituirán el contenido
 * placeholder por su formulario real sin tocar este shell.
 */
export function BottomSheet({ open, onClose, title, children }) {
  // Guarda de montaje: createPortal(..., document.body) no puede ejecutarse
  // en el servidor (document no existe ahí). MIS-10 siempre abre con
  // open=false inicial, pero como componente genérico reutilizable por
  // MIS-11/12/14/15, un futuro caller podría montar con open=true — este
  // guard lo deja seguro para ese caso también (hallazgo menor de la
  // auditoría de código v1). useSyncExternalStore en vez de
  // useState+useEffect: el lint react-hooks/set-state-in-effect de este
  // proyecto prohíbe setState síncrono dentro de un efecto.
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const titleId = React.useId();
  const sheetRef = React.useRef(null);
  const previousFocusRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;

    const focusable = sheetRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? sheetRef.current)?.focus();

    // Bloquea el resto de la app para foco de teclado y lectores de
    // pantalla mientras la hoja está abierta, con el atributo nativo
    // `inert` sobre sus hermanos en document.body — evita reinventar un
    // focus-trap manual (hallazgo mayor de la auditoría de plan v1→v2).
    const siblings = Array.from(document.body.children).filter(
      (el) => el !== sheetRef.current?.parentElement,
    );
    siblings.forEach((el) => el.setAttribute('inert', ''));

    const onKeyDown = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      siblings.forEach((el) => el.removeAttribute('inert'));
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !isClient) return null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)' }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 101,
          background: 'var(--color-surface)',
          borderRadius: '20px 20px 0 0',
          maxHeight: '92vh',
          overflowY: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom)',
          animationName: 'mis10-sheet-slide-up',
          animationDuration: '.22s',
          animationTimingFunction: 'ease-out',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }} aria-hidden="true">
          <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--color-border)' }} />
        </div>
        {title && (
          <h2
            id={titleId}
            style={{ padding: '0 20px 8px', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}
          >
            {title}
          </h2>
        )}
        <div style={{ padding: '0 20px 20px' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
