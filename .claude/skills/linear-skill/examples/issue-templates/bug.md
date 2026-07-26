# Title (replace this)

[Síntoma, no solución. Ej: "Validación de password rechaza caracteres especiales"]

---

## Síntoma

[1-2 frases de qué pasa que no debería.]

## Severidad

**S?** — [S1 = crítico/producción / S2 = alto / S3 = medio / S4 = cosmético]

Justificación: [Por qué este nivel]

## Repro

1. Paso concreto
2. Paso concreto
3. Paso concreto
4. Paso concreto

## Resultado esperado

[Qué debería pasar después de los pasos.]

## Resultado observado

[Qué pasa realmente. Pegar error message exacto si lo hay.]

## Ambiente

- **Producción** / Staging / Local
- Browser/OS: [si aplica]
- Versión del producto: [commit / tag]
- Usuario afectado: [rol o tipo]
- Frecuencia: siempre / ocasional / 1 vez

## Evidencia

- Screenshot: [adjunto/link]
- Logs: [adjunto/link a Datadog/Sentry]
- Error message: `<paste exacto>`
- Sentry issue: [link]

## Hipótesis (opcional)

[Donde sospechas que está el bug — solo si tienes pista.]
- Probablemente en `<archivo>` línea ~N
- Posible cambio reciente: PR #X (commit hace N tiempo)

## Workaround

[Si hay alguno, mientras se arregla. NO opcional para S1/S2.]

## Test que debería pasar

```typescript
// Test que reproduce el bug. Debería fallar antes del fix.
test('descripción del comportamiento esperado', () => {
  const result = funcionConBug(input);
  expect(result).toEqual(expectedOutput);
});
```

Si no tienes test específico todavía, la primera tarea del fix es escribirlo.

## Out of scope

[Si el reporte original mencionaba otras cosas que no son este bug]

---

**Labels sugeridos**: `vertical/<X>`, `type/bug`, `area/<X>`
**Priority sugerida**:
- S1 → Urgent (1)
- S2 → High (2)
- S3 → Medium (3)
- S4 → Low (4)

**Estimate sugerido**: 1, 2 o 3 (Fibonacci). Bug ≥5 puntos: probablemente requiere descomponer (¿es bug o es refactor disfrazado?).
