# Vibe Coder CRM — Design System

CRM minimalista para pequeños negocios de ventas digitales. **Limpio, operativo, sin distracciones.** Profesional pero accesible para personas no técnicas. **Mobile-first, modo claro siempre** (sin dark mode). Referentes: **Linear, Notion, Mercury Bank** — alta densidad informativa con mucho aire y claridad.

> **Fuentes / materiales recibidos:** un paquete portable (`Vibe Coder CRM Design System.zip`) con la spec (`design.md`), los tokens CSS y tarjetas de foundations. No se entregó codebase, Figma ni logotipo de marca. Los componentes React, el UI kit y el monograma de este sistema fueron construidos a partir de esa spec. Ver CAVEATS al final.

---

## Manifiesto del root

| Archivo / carpeta | Qué es |
|---|---|
| `design.md` | Spec portable de una página — pégalo en cualquier IA/agente. Valores completos + patrones + do/don't. |
| `styles.css` | **Entry point global** (solo `@import`). Los consumidores enlazan este archivo. |
| `tokens/` | `colors.css`, `typography.css`, `spacing.css`, `radii-shadows.css` — custom properties. |
| `components/` | Primitivas React: `core/`, `forms/`, `feedback/`, `navigation/`. |
| `ui_kits/crm/` | Recreación interactiva de la app (login → resumen → pipeline → ficha). |
| `guidelines/` | Tarjetas de foundations (`@dsCard`) — color, tipo, spacing, marca. |
| `assets/` | `logo-monogram.svg` (placeholder). |
| `SKILL.md` | Definición de skill (Agent Skills / Claude Code). |
| `Foundations.html` | Referencia visual de los fundamentos (color, tipo, spacing, sombras, badges) — abre en el navegador. |

### Componentes (`window.VibeCoderCRMDesignSystem_cdaf1f`)
`Button` · `Card` · `Avatar` · `Input` · `Select` · `Checkbox` · `Switch` · `Badge` · `StatusBadge` (+ `PIPELINE_STATES`) · `Tabs`.

### UI kit
`ui_kits/crm/index.html` — app completa interactiva: pantalla de login, resumen con KPIs y actividad, pipeline kanban de 5 etapas, y ficha de contacto con timeline.

---

## Foundations en una línea

- **Color de marca:** azul pizarra `#3B5266` (único color de acción).
- **Tipografía:** Inter, escala 24/20/18/16/14/12, pesos 400–700. Mono: JetBrains Mono para cifras.
- **Espaciado:** base 4px (4 → 64).
- **Bordes:** 4/8/12/16/24/full. **Sombras:** sm/md/lg, sutiles y teñidas de navy.
- **Estados del pipeline:** 7 badges (lead, en conversación, propuesta, negociando, ganado, perdido, inactivo).

Consulta `design.md` para los valores completos y reglas do/don't.

---

## CONTENT FUNDAMENTALS — cómo se escribe

**Idioma:** **español**, registro neutro internacional. La interfaz, los labels y los datos de ejemplo van en español.

**Tono:** operativo y directo, sin marketing ni floritura. Frases cortas. Se nombra la acción concreta ("Guardar contacto", "Nuevo negocio", "Volver al pipeline"), nunca genéricos vacíos como "Enviar" o "Aceptar" cuando se puede ser específico.

**Persona / voz:** orientada a la tarea, no conversacional. Se evita el "nosotros" corporativo. Los mensajes del sistema describen el hecho ("5 tareas vencen hoy", "Negocio ganado"), no hablan en primera persona.

**Casing:** **Sentence case** en todo — botones, títulos, labels, nav ("Nuevo negocio", no "Nuevo Negocio" ni "NUEVO NEGOCIO"). La única excepción es el caption/label de 12px, que puede ir en MAYÚSCULAS con tracking `0.04em` para metadatos discretos (p. ej. cabeceras de columna pequeñas).

**Números y dinero:** formato local español (`$48,200`, `34%`, `+12%`). Las cifras clave (importes, IDs, métricas) usan **JetBrains Mono** para alineación y peso visual. Los IDs de negocio siguen el patrón `VC-NNNN`.

**Estado, no adjetivos:** el estado se comunica con un badge de pipeline, no con prosa. "En conversación" es un `StatusBadge`, no una frase.

**Sin emoji decorativos.** Nada de iconos de relleno ni "data slop" (números o stats que no aportan). Una sola acción primaria por pantalla; el resto del texto es neutro.

**Ejemplos de copy real:**
- Botones: "Guardar contacto" · "Nuevo negocio" · "Entrar" · "Email" · "Llamar" · "Añadir".
- Vacíos: "Sin notas todavía." · "Vista de demostración".
- Actividad: "Ana Torres respondió a tu propuesta" · "recordatorio: 5 tareas vencen hoy".
- Métricas: "Ingresos del mes" · "Tasa de cierre" · "Por vencer hoy".

---

## VISUAL FOUNDATIONS — motivos y mecánica

**Vibe general:** software de trabajo sereno y de alta densidad. Mucho aire, jerarquía por tipografía y espacio (no por cajas ni sombras fuertes). Cero decoración: cada elemento se gana su sitio.

**Color.** Modo claro siempre. Lienzo `#FAFAFA`, superficies `#FFFFFF` (blanco roto, nunca blanco frío de cristal). Un **único color de acción**: azul pizarra `#3B5266`, reservado para la acción primaria, la selección y el foco. El color **solo comunica estado**: verde = ganado, ámbar = urgente, rojo = perdido, gris = inactivo. Prohibido usar verde para la acción primaria (choca con "Ganado").

**Tipografía.** Inter en todo, jerarquía por tamaño/peso (no por color de fondo). Display 24/700 con tracking `-0.02em`; títulos `-0.01em`; cuerpo 14–16 con interlineado 1.5–1.6. JetBrains Mono **solo** para valores numéricos (importes, IDs, porcentajes, fechas técnicas).

**Espaciado / layout.** Base 4px. Se agrupa con flex/grid + `gap`, nunca con márgenes sueltos. Una columna de lectura en móvil; en escritorio, sidebar fija de 232px + área principal con header sticky de 60px. Hit targets ≥ 44px, cuerpo nunca < 14px.

**Fondos.** Planos. **Sin gradientes, sin imágenes full-bleed, sin texturas ni patrones, sin glassmorphism.** El único uso de transparencia/blur admitido es la barra superior translúcida (`rgba(255,255,255,.85)` + `backdrop-filter: blur(12px)`) sobre borde hairline; úsalo con moderación.

**Bordes.** Líneas hairline `#E5E7EB` (1px); inputs y divisores marcados `#D1D5DB`. Radios: botones/inputs `8px`, cards `12px`, badges y avatares `full`. Nunca esquinas a 90° sin radio.

**Sombras.** Sutiles y **teñidas de navy**, nunca negras duras. `sm` para cards, `md` para popovers/modales y hover, `lg` para overlays/sheets. La elevación sube **un nivel** en hover, no más.

**Cards.** `background:#fff` + borde hairline `#E5E7EB` + `radius.lg` + `shadow.sm`. Padding 16–20px. En hover interactivo: `shadow.md` y, en tarjetas de negocio, `translateY(-1px)`.

**Estados / motion.** Calmados, sin rebotes. Transiciones `0.15–0.22s ease-out`. Hover: oscurecer un punto + subir un nivel de sombra. Press: `transform: scale(0.97)` (botón) — sin bounce. Foco: anillo suave `0 0 0 3px rgba(59,82,102,.18–.25)` en el acento. Selección / nav activa: fondo `accent.tint` `#EAEFF3` + texto acento + peso 600.

**Imágenes.** Apenas se usan. Los avatares son iniciales sobre tinte determinista dentro de la familia slate/neutral (sin fotos por defecto). No hay fotografía de marca; si se añadiera, debería ser cálida y discreta, nunca protagonista.

---

## ICONOGRAPHY

**Sistema:** no se entregó un set de iconos en los materiales. Se usa **Lucide** (lucide.dev, ISC) — la familia de trazo fino y geométrico que mejor encaja con la estética Linear/Notion del producto. En el UI kit los iconos están implementados como SVG inline (`ui_kits/crm/icons.jsx`, componente `<Icon name size color strokeWidth />`) usando los *path data* de Lucide, a **24×24, stroke 2, linecap/linejoin `round`**, en `currentColor`.

**Reglas de uso:**
- Tamaños: 16px (inline, dentro de texto/inputs), 18px (nav, botones de header), 20–32px (vacíos/estados).
- Color: `--text-tertiary` (iconos decorativos/secundarios), `--text-secondary` (interactivos), `--color-accent` (activos/destacados), `#fff` sobre el acento.
- Trazo coherente (2px) en todo el sistema; no mezclar fills con strokes.
- **Sin emoji** como iconos. **Sin caracteres unicode** como sustituto de iconos. El chevron del `Select` y el check del `Checkbox` son SVG, no glifos.

**Logotipo:** monograma "V" en azul pizarra con esquina `radius` 8–12px (`assets/logo-monogram.svg`). **Es un placeholder** construido por falta de un logo oficial — ver CAVEATS.

**Para ampliar el set:** añade el `path data` de la pieza correspondiente en `PATHS` dentro de `icons.jsx`, manteniendo 24×24 / stroke 2. Alternativamente, en proyectos que consumen este sistema, enlaza Lucide desde CDN.

---

## CAVEATS

1. **Sin logo oficial.** `assets/logo-monogram.svg` y el lockup "Vibe Coder · CRM" son un **placeholder** derivado del monograma "V" que aparecía en la spec. Reemplázalo por el logotipo real cuando esté disponible.
2. **Iconografía sustituida.** Se usó **Lucide** por no haber un set propio en los materiales. Si la marca tiene un set de iconos, cámbialo en `ui_kits/crm/icons.jsx`.
3. **Inter / JetBrains Mono vía Google Fonts.** La spec define Inter como fuente única; no se entregaron archivos de fuente, así que se cargan desde Google Fonts (`tokens/typography.css`). Sustituye por los binarios `@font-face` si quieres autohospedaje.
4. **Datos del UI kit ficticios** (`ui_kits/crm/data.js`) — ilustrativos, no producción.

> Documento vivo. Actualízalo a medida que el sistema crezca.
