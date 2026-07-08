---
name: vibe-coder-crm-design
description: Use this skill to generate well-branded interfaces and assets for Vibe Coder CRM (a minimalist, light-mode, mobile-first CRM for small digital-sales businesses), either for production or throwaway prototypes/mocks/slides. Contains design guidelines, color/type/spacing/shadow tokens, the Inter type system, reusable React components, pipeline status badges, a full CRM UI kit, and a dashboard template.
user-invocable: true
---

Read `readme.md` for the full design guide (content fundamentals, visual foundations, iconography, file index) and `design.md` for the portable one-page spec (tokens + component patterns + do/don't). The machine-readable tokens live in `styles.css` → `tokens/*.css`; link `styles.css` and consume the CSS custom properties (`var(--color-accent)`, etc.) instead of hardcoding hex.

What's here:
- `tokens/` + `styles.css` — color, typography (Inter / JetBrains Mono), spacing (base 4px), radii & shadows.
- `components/` — React primitives: `Button`, `Card`, `Avatar`, `Input`, `Select`, `Checkbox`, `Switch`, `Badge`, `StatusBadge` (+ `PIPELINE_STATES`), `Tabs`. Each has a `.d.ts` + `.prompt.md`.
- `ui_kits/crm/` — interactive recreation of the app (login → resumen → pipeline → ficha de contacto). `icons.jsx` is the Lucide-based icon set.
- `templates/crm-dashboard/` — a ready-to-customize dashboard starting point.
- `assets/logo-monogram.svg` — brand monogram (placeholder — replace with the real logo).

Core rules:
- **Modo claro siempre.** Mobile-first. Fuente **Inter**. Acento de marca **azul pizarra `#3B5266`** — única acción.
- Una sola acción primaria por pantalla; el color solo comunica estado (verde ganado, ámbar urgente, rojo perdido, gris inactivo).
- Copy en **español**, sentence case, sin emoji decorativos ni "data slop". Cifras en JetBrains Mono.
- Espaciado base 4px; cards `radius.lg`, botones `radius.md`, badges `radius.full`. Sombras sutiles teñidas de navy. Sin gradientes, glassmorphism ni dark mode.

If creating visual artifacts (mocks, prototypes, slides), produce static HTML that links `styles.css`, copies the assets/icons you need, and reuses the tokens + components. If working on production code, read `readme.md` + `design.md` and apply the tokens as `var(--*)`.
If invoked without guidance, ask what to build, ask a few questions, and act as an expert designer for this brand.
