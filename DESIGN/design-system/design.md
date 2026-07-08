# Vibe Coder CRM — Design System (portable)

> CRM minimalista para pequeños negocios de ventas digitales.
> **Limpio · operativo · sin distracciones.** Profesional pero accesible para gente no técnica. **Mobile-first. Modo claro siempre** (sin dark mode).

Este documento es autosuficiente: pégalo en cualquier IA o agente y tendrá todo lo necesario para construir pantallas coherentes con la marca. Referentes: **Linear, Notion, Mercury Bank** — alta densidad informativa con mucho aire y claridad.

---

## 1. Principios

1. **Una sola acción primaria por pantalla.** El color de marca (azul pizarra) se reserva para la acción principal y la selección; el resto es neutro.
2. **El color comunica estado, no decora.** Verde = ganado, ámbar = urgente, rojo = perdido, gris = inactivo.
3. **Jerarquía por tipografía y espacio, no por cajas y sombras.** Sombras sutiles, bordes hairline.
4. **Móvil primero.** Hit targets ≥ 44px, texto cuerpo nunca < 14px, una columna de lectura.
5. **Sin ruido:** nada de gradientes azul-violeta, emoji decorativos, ni "data slop".

---

## 2. Color

Fondos en blanco roto, nunca blanco frío de cristal. El azul pizarra es el único color de acción.

### Marca / acento
| Token | Hex | Uso |
|---|---|---|
| `color.accent` | `#3B5266` | Acción primaria, selección, foco |
| `color.accent.hover` | `#2E4252` | Hover del primario |
| `color.accent.press` | `#233442` | Estado pressed |
| `color.accent.tint` | `#EAEFF3` | Fondo suave (chips activos, selección) |
| `color.accent.subtle` | `#D6E0E6` | Bordes/fills aún más suaves |
| `color.accent.contrast` | `#FFFFFF` | Texto sobre el acento |

### Semánticos
| Token | Base | Fondo | Texto | Uso |
|---|---|---|---|---|
| `color.success` | `#16A34A` | `#DCFCE7` | `#15803D` | Venta ganada |
| `color.warning` | `#F59E0B` | `#FEF3C7` | `#B45309` | Pendiente urgente |
| `color.danger` | `#EF4444` | `#FEE2E2` | `#B91C1C` | Perdido / destructivo |
| `color.neutral` | `#6B7280` | `#F3F4F6` | `#374151` | Inactivo / sin estado |

### Superficie & borde
| Token | Hex | Uso |
|---|---|---|
| `color.bg` | `#FAFAFA` | Lienzo de la app |
| `color.surface` | `#FFFFFF` | Cards, paneles, modales |
| `color.muted` | `#F3F4F6` | Filas, hover, fills |
| `color.border` | `#E5E7EB` | Líneas hairline |
| `color.border.strong` | `#D1D5DB` | Inputs, foco, divisores marcados |

### Texto
| Token | Hex | Uso |
|---|---|---|
| `text.primary` | `#1A1D24` | Títulos y datos clave |
| `text.secondary` | `#6B7280` | Descripciones, labels |
| `text.tertiary` | `#9CA3AF` | Metadatos, hints, placeholders |

---

## 3. Tipografía

**Fuente única: Inter** (Google Fonts). Mono opcional para valores/código: JetBrains Mono.

| Rol | Tamaño | Peso | Tracking | Uso |
|---|---|---|---|---|
| Display | 24px | 700 | -0.02em | Cifras grandes, títulos de pantalla |
| Heading L | 20px | 600 | -0.01em | Títulos de sección |
| Heading S | 18px | 600 | -0.01em | Subtítulos, títulos de card |
| Body L | 16px | 400 | 0 | Cuerpo principal |
| Body S | 14px | 400 | 0 | Apoyo, formularios, tablas |
| Caption | 12px | 500 | 0.01em | Labels, timestamps |

Pesos disponibles: **400 Regular · 500 Medium · 600 SemiBold · 700 Bold**.
Interlineado: títulos `1.25`, cuerpo `1.5–1.6`.

```css
font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
```

---

## 4. Espaciado — base 4px

Una escala única para padding, gap y margin.

| Token | px |
|---|---|
| `space.1` | 4 |
| `space.2` | 8 |
| `space.3` | 12 |
| `space.4` | 16 |
| `space.5` | 20 |
| `space.6` | 24 |
| `space.8` | 32 |
| `space.10` | 40 |
| `space.12` | 48 |
| `space.16` | 64 |

Usa flex/grid con `gap` para agrupar elementos; evita márgenes sueltos.

---

## 5. Bordes y sombras

### Radius
| Token | px |
|---|---|
| `radius.sm` | 4 |
| `radius.md` | 8 |
| `radius.lg` | 12 |
| `radius.xl` | 16 |
| `radius.2xl` | 24 |
| `radius.full` | 999 (pills) |

Botones e inputs `radius.md`; cards `radius.lg/xl`; badges y avatares `radius.full`.

### Sombras (teñidas de navy, sutiles — nunca negras duras)
| Token | Valor | Uso |
|---|---|---|
| `shadow.sm` | `0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)` | Cards |
| `shadow.md` | `0 4px 8px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.10)` | Modales, popovers |
| `shadow.lg` | `0 12px 24px rgba(16,24,40,.08), 0 24px 48px rgba(16,24,40,.14)` | Overlays, sheets |

---

## 6. Badges de estado del pipeline

Pill `radius.full`, texto 12–13px peso 600, fondo suave + texto saturado del mismo tono. Punto de color opcional a la izquierda.

| Estado | Token | Fondo | Texto |
|---|---|---|---|
| Lead nuevo | `status.lead` | `#E0F2FE` | `#0369A1` |
| En conversación | `status.talking` | `#EAEFF3` | `#3B5266` |
| Propuesta enviada | `status.proposal` | `#F3E8FF` | `#7E22CE` |
| Negociando | `status.negotiating` | `#FFEDD5` | `#C2410C` |
| Ganado | `status.won` | `#DCFCE7` | `#15803D` |
| Perdido | `status.lost` | `#FEE2E2` | `#B91C1C` |
| Inactivo | `status.inactive` | `#F3F4F6` | `#6B7280` |

```html
<span style="font:600 13px/1 Inter; color:#3B5266; background:#EAEFF3;
             padding:5px 12px; border-radius:999px;">En conversación</span>
```

---

## 7. Patrones de componente

**Botón primario** — `background:#3B5266; color:#fff; padding:9px 14px; border-radius:8px; font:600 14px Inter`. Hover `#2E4252`. Press `transform:scale(.97)`. Foco: anillo `0 0 0 3px rgba(59,82,102,.25)`.

**Botón secundario** — `background:#fff; color:#374151; border:1px solid #E5E7EB`. Hover `background:#F3F4F6`.

**Card** — `background:#fff; border:1px solid #E5E7EB; border-radius:12px; box-shadow: shadow.sm`. Padding `16–20px`.

**Input** — `background:#fff; border:1px solid #D1D5DB; border-radius:8px; padding:10px 12px; font:400 14px Inter`. Foco: `border-color:#3B5266; box-shadow:0 0 0 3px rgba(59,82,102,.18)`.

**Item seleccionado / nav activa** — `background:#EAEFF3; color:#3B5266; font-weight:600`.

### Estados y motion
- Hover: oscurecer un punto + sombra un nivel mayor.
- Press: `scale(0.97)`, sin rebote.
- Foco: anillo `#3B5266` suave.
- Transiciones: `0.18–0.22s ease-out`. Calmadas, sin bounces.

---

## 8. Do / Don't

**Sí**
- Modo claro, fondos `#FAFAFA`/`#FFFFFF`.
- Inter en todo; jerarquía por tamaño/peso.
- Un acento de marca; color solo para estado.
- Mobile-first, hit targets ≥ 44px, cuerpo ≥ 14px.

**No**
- Dark mode, gradientes azul-violeta, glassmorphism.
- Emoji decorativos ni iconos de relleno.
- Verde para la acción primaria (choca con "Ganado").
- Sombras negras duras o esquinas a 90° sin radio.

---

*Vibe Coder CRM · Design System v1.0 — documento vivo.*
