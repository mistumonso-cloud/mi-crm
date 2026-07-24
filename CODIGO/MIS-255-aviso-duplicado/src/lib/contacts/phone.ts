// Normalización de teléfono para detectar posibles duplicados al crear un
// contacto (MIS-255, AC: "comparar por teléfono normalizado — ignorar
// espacios, guiones, prefijo"). Vive en su propio archivo, no en
// src/lib/contacts/format.ts: format.ts son formatters de SALIDA (fecha,
// hora, importe -> texto para mostrar); esto es una clave de comparación
// para lógica de negocio (¿es "el mismo" teléfono que otro ya guardado?),
// categoría distinta — mismo criterio de un concepto por archivo pequeño
// que ya usa este directorio (channel.ts para el enum de canal, status.ts
// para los enums de estado).
//
// No reutiliza el `digitsOnly` privado de ContactList.tsx (MIS-9): aquel
// existe para búsqueda por SUBSTRING mientras se escribe en el buscador de
// la lista (cualquier fragmento de dígitos que aparezca dentro del
// teléfono cuenta como acierto). Esto necesita una CLAVE DE IGUALDAD
// EXACTA para duplicados — semántica distinta, aunque ambas empiecen
// quitando lo que no sea dígito. Se duplica esa línea a propósito, mismo
// criterio ya aceptado en el repo para pequeñas normalizaciones sin fuente
// compartida entre módulos (p.ej. contactChannelValidator duplicado entre
// convex/schema.ts y convex/contacts.ts).

// Longitud de un número de teléfono español completo — igual para móvil y
// fijo (España no distingue longitud por tipo de línea, a diferencia de
// otros países). Mismo supuesto de un solo país ya aceptado en este
// directorio (ver timeZone "Europe/Madrid" fija en format.ts).
const SPAIN_PHONE_DIGITS = 9;

// Deja solo los dígitos y, si hay más de 9, se queda con los últimos 9 —
// el número nacional real, sea cual sea lo que venga delante (+34, 0034,
// un 0 de marcación de más...). Así "+34600000000", "34 600 000 000",
// "0034-600-000-000" y "600000000" normalizan los 4 al mismo valor, sin
// necesitar un parser de prefijos internacionales real (tipo
// libphonenumber) — el AC solo pide tolerar espacios/guiones/prefijo, no
// validación de formato completa.
//
// Por debajo de 9 dígitos se devuelve "" (no los dígitos parciales tal
// cual): un número de España real nunca tiene una coincidencia válida por
// debajo de esa longitud, y devolver el prefijo parcial arriesgaba (a)
// avisos prematuros mientras Carlos todavía está escribiendo, y (b) un
// falso aviso si algún contacto antiguo tuviera un teléfono igual de
// corto/mal formado (phone es v.optional(v.string()) en el schema, sin
// regex de formato server-side — ver PHONE_MAX en convex/contacts.ts). El
// llamador (NewContactForm.tsx) trata "" como "todavía sin clave, no
// comprobar".
//
// Colisión entre dos personas reales distintas: para un número de España
// completo, esta clave ES el número entero — dos contactos con la misma
// clave son, por definición, el mismo teléfono, no una coincidencia de
// "últimos 9 dígitos" entre números distintos.
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < SPAIN_PHONE_DIGITS) return "";
  return digits.slice(-SPAIN_PHONE_DIGITS);
}
