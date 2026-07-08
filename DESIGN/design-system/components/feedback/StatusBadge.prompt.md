Pill de estado del pipeline de ventas — el componente que define el CRM. 7 estados canónicos con punto de color.

```jsx
<StatusBadge state="won" />
<StatusBadge state="negotiating" label="En negociación" />
```

Estados: `lead`, `talking`, `proposal`, `negotiating`, `won`, `lost`, `inactive`. El label en español sale por defecto; `label` lo sobrescribe. `dot={false}` oculta el punto. Mapa de colores exportado en `PIPELINE_STATES`.
