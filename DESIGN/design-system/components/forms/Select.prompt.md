Select nativo estilizado con la estética de Input.

```jsx
<Select label="Estado" value={s} onChange={e => setS(e.target.value)}
  options={[{value:'won',label:'Ganado'},{value:'lost',label:'Perdido'}]} />
```

`options` admite strings u objetos `{value,label}`. Props: `label`, `size` (`sm | md`), `disabled`. Chevron incluido.
