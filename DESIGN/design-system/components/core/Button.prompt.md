Botón de acción de Vibe Coder CRM — una sola acción primaria por pantalla; el acento azul pizarra se reserva para ella.

```jsx
<Button variant="primary" onClick={save}>Guardar contacto</Button>
<Button variant="secondary">Cancelar</Button>
```

Variantes: `primary` (acento, acción principal), `secondary` (blanco + borde), `ghost` (sin fondo), `danger` (destructivo). Tamaños `sm | md | lg` (lg = 44px hit target). Props: `iconLeft`, `iconRight`, `full`, `disabled`. Hover oscurece un punto; press hace `scale(0.97)` sin rebote.
