Campo de texto con label, hint y error. Anillo de foco azul pizarra.

```jsx
<Input label="Email" type="email" placeholder="ana@empresa.com" />
<Input label="Importe" prefix="$" error="Requerido" />
```

Props: `label`, `hint`, `error` (pone el campo en rojo), `prefix`, `suffix`, `size` (`sm | md`), `disabled`. Reenvía el resto de props al `<input>`.
