Contenedor de superficie blanca con borde hairline y sombra sutil teñida de navy — la unidad base de layout.

```jsx
<Card padding="md" interactive>
  <h3>Ana Torres</h3>
  <StatusBadge state="negotiating" />
</Card>
```

Props: `padding` (`sm | md | lg` o número), `interactive` (eleva la sombra en hover), `selected` (borde acento). Radius `lg`. No apiles sombras fuertes; la jerarquía viene del tipo y el espacio.
