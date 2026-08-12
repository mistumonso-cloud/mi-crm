# passwordCorpus.json — procedencia, licencia e integridad

Corpus de contraseñas comunes para la política de contraseñas (MIS-290, I6).
Se usa como **lista de bloqueo**: una contraseña cuya forma normalizada esté en
el corpus se rechaza. Versionado en el repo, **sin descargas en tiempo de
ejecución**.

## Procedencia

- **Fuente:** [SecLists](https://github.com/danielmiessler/SecLists),
  `Passwords/Common-Credentials/10k-most-common.txt`.
- **Licencia de la fuente:** MIT (SecLists) — permite redistribución con la nota
  de copyright; es una lista de contraseñas públicas, no contiene datos
  personales.
- **Fichero fuente:** 10.000 líneas, 73.017 bytes.
- **SHA-256 del fichero fuente (antes de normalizar):**
  `4adb3f0afb4a10cf19ebe48d8c69a46f934bbc8d77c694c210564f9583e7f4ba`

## Transformación aplicada

Cada línea se **normaliza** con la misma función que `normalizePassword` en
`passwordPolicy.ts` (debe mantenerse idéntica byte a byte):

1. `trim` + minúsculas.
2. Quitar dígitos finales (`/[0-9]+$/`), **salvo** si el resultado queda vacío
   (contraseña toda numérica) → se conserva literal, para no colapsar todos los
   numéricos en `""`.

Luego se **deduplica** y se añaden los **términos del proyecto**
(`mistumonso`, `vibecoder`, `vibe coder`, `crm`, `mistu-monso`,
`mistu-monso.com`, `mistumonso.com`, normalizados por la misma función).

## Artefacto (`passwordCorpus.json`)

- **Entradas normalizadas (dedup):** 9.205.
- **Tamaño:** ~85 KB (coste de bundle irrelevante).
- **SHA-256 del JSON:**
  `b7643b67c9dc9757dd1f7a8c9e4e1ab61c686a51613d1abb38d8e3f8285624fa`

Para regenerarlo (si se sube la versión de la política o se cambia la fuente),
aplicar la misma normalización + dedup + términos del proyecto y **actualizar
este SHA-256**. El hash permite detectar cambios accidentales del fichero.
