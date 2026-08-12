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

// MIS-290 (M4): SEGUNDA identidad dedicada, exclusiva para la prueba end-to-end
// del flujo de alta (seedUser + accountsPendingRotation). Se siembra y se borra
// dentro de la propia prueba; nunca es la identidad de login ni una cuenta real.
export const SEED_TEST_EMAIL = "seed@test.local";

// Nombre de la env var de Convex con la credencial de alta entropía que protege
// el harness. En producción NO debe existir: su ausencia deja inertes todas las
// funciones de testSupport (fail-closed).
export const TEST_SUPPORT_ENV_VAR = "E2E_TEST_SUPPORT_KEY";

// MIS-290 (prueba 8, I5): IP sintética dedicada a las pruebas del límite por IP.
// TEST-NET-3 (RFC 5737): no rutable y de nadie, así que es seguro que el harness
// limpie su clave `ip:` (a diferencia de las IP reales, compartidas). Vive aquí
// (módulo ligero, sin dependencias de servidor) para que el spec e2e la importe
// sin arrastrar el grafo de convex/testSupport.
export const TEST_LOGIN_IP = "203.0.113.42";
