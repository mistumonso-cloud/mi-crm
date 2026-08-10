// MIS-286: identidad dedicada para las pruebas e2e de recuperación de contraseña.
//
// Vive en un único sitio porque la comparten dos módulos que deben coincidir
// EXACTAMENTE: convex/testSupport.ts (el harness, que solo opera sobre esta
// identidad) y convex/passwordReset.ts (MIS-285, que solo escribe en el outbox
// de test cuando el destinatario es esta identidad). Una divergencia entre
// ambos silenciaría el outbox o abriría el harness a otras cuentas.
//
// Ya normalizado (minúsculas), tal y como lo devolvería normalizeEmailKey.
export const RESET_TEST_EMAIL = "reset@test.local";

// Nombre de la env var de Convex con la credencial de alta entropía que protege
// el harness. En producción NO debe existir: su ausencia deja inertes todas las
// funciones de testSupport (fail-closed).
export const TEST_SUPPORT_ENV_VAR = "E2E_TEST_SUPPORT_KEY";
