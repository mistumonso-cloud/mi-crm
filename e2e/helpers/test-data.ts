// Sufijo único por ejecución — evita colisionar con datos de ejecuciones
// anteriores del propio suite, o con datos manuales de desarrollo, en el
// mismo deployment de Convex compartido (dutiful-mole-111).
export function uniqueContactName(label: string): string {
  return `E2E ${label} ${Date.now()}`;
}

// Contador de módulo — uniquePhone() se llama más de una vez por test
// (contacto principal + contacto de control), y derivar solo de Date.now()
// podría colisionar si dos llamadas caen en el mismo milisegundo.
let phoneCounter = 0;

export function uniquePhone(): string {
  // +34 6XX XXX XXX: 5 dígitos del timestamp + 1 dígito de contador
  // incremental, para que dos llamadas en el mismo milisegundo sigan
  // produciendo números distintos.
  phoneCounter = (phoneCounter + 1) % 10;
  const suffix = String(Date.now()).slice(-5) + String(phoneCounter);
  return `+34 600 ${suffix.slice(0, 3)} ${suffix.slice(3)}`;
}
