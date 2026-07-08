Tabs subrayadas. Tab activa usa el acento de marca.

```jsx
<Tabs value={tab} onChange={setTab}
  tabs={[{value:'all',label:'Todos'},{value:'won',label:'Ganados'}]} />
```

`tabs` admite strings u objetos `{value,label}`. `onChange` recibe el `value`.
