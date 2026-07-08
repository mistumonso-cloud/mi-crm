// Fake data for the Vibe Coder CRM UI kit. Not production — illustrative only.
window.CRM_DATA = {
  user: { name: 'Lucía Méndez', email: 'lucia@vibecoder.app', role: 'Ventas' },

  kpis: [
    { label: 'Ingresos del mes', value: '$48,200', delta: '+12%', tone: 'success' },
    { label: 'Negocios abiertos', value: '23', delta: '+4', tone: 'accent' },
    { label: 'Tasa de cierre', value: '34%', delta: '+3pts', tone: 'success' },
    { label: 'Por vencer hoy', value: '5', delta: 'urgente', tone: 'warning' },
  ],

  // Pipeline stages in order. state matches StatusBadge states.
  stages: [
    { key: 'lead', label: 'Lead nuevo' },
    { key: 'talking', label: 'En conversación' },
    { key: 'proposal', label: 'Propuesta enviada' },
    { key: 'negotiating', label: 'Negociando' },
    { key: 'won', label: 'Ganado' },
  ],

  deals: [
    { id: 'VC-2048', name: 'Tienda Aurora', contact: 'Ana Torres', company: 'Aurora SL', amount: 12480, stage: 'negotiating', prob: 78, due: 'En 3 días' },
    { id: 'VC-2051', name: 'Web Restaurante Sol', contact: 'Bruno Gil', company: 'Grupo Sol', amount: 6200, stage: 'proposal', prob: 55, due: 'Mañana' },
    { id: 'VC-2052', name: 'App Reservas', contact: 'Carmen Ruiz', company: 'Bahía Tours', amount: 18900, stage: 'talking', prob: 30, due: 'En 5 días' },
    { id: 'VC-2055', name: 'Landing Lanzamiento', contact: 'Diego Paz', company: 'Nova Labs', amount: 3400, stage: 'lead', prob: 15, due: 'Sin fecha' },
    { id: 'VC-2056', name: 'Rediseño Catálogo', contact: 'Elena Soto', company: 'Mobel', amount: 9100, stage: 'won', prob: 100, due: 'Cerrado' },
    { id: 'VC-2057', name: 'Integración Pagos', contact: 'Félix Romero', company: 'PayFlow', amount: 14200, stage: 'negotiating', prob: 64, due: 'Hoy' },
    { id: 'VC-2059', name: 'Newsletter Setup', contact: 'Gabriela Lima', company: 'Verde Co.', amount: 2100, stage: 'talking', prob: 25, due: 'En 8 días' },
    { id: 'VC-2061', name: 'Portal Clientes', contact: 'Hugo Vargas', company: 'Atlas', amount: 21500, stage: 'lead', prob: 10, due: 'Sin fecha' },
    { id: 'VC-2062', name: 'Tienda Moda Fina', contact: 'Irene Castro', company: 'Hilo', amount: 7600, stage: 'proposal', prob: 48, due: 'En 2 días' },
  ],

  activity: [
    { who: 'Ana Torres', what: 'respondió a tu propuesta', when: 'hace 12 min', icon: 'mail' },
    { who: 'Félix Romero', what: 'pidió agendar una llamada', when: 'hace 1 h', icon: 'phone' },
    { who: 'Elena Soto', what: 'firmó — negocio ganado', when: 'hace 3 h', icon: 'check' },
    { who: 'Sistema', what: 'recordatorio: 5 tareas vencen hoy', when: 'hace 5 h', icon: 'bell' },
  ],

  // Contact detail subject
  contact: {
    name: 'Ana Torres',
    role: 'Fundadora · Aurora SL',
    company: 'Aurora SL',
    email: 'ana@aurora.es',
    phone: '+34 600 123 456',
    stage: 'negotiating',
    value: 18900,
    since: 'Cliente desde marzo 2026',
    timeline: [
      { icon: 'mail', title: 'Propuesta enviada', detail: 'Plan Pro anual · $18,900', when: '2 jul' },
      { icon: 'phone', title: 'Llamada de descubrimiento', detail: '32 min · necesita migrar antes de Q3', when: '28 jun' },
      { icon: 'note', title: 'Nota', detail: 'Prefiere pago trimestral. Decisor único.', when: '27 jun' },
      { icon: 'zap', title: 'Lead creado', detail: 'Origen: formulario web', when: '24 jun' },
    ],
  },
};
