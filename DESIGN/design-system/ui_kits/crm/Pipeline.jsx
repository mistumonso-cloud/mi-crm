const { Card, Avatar } = window.VibeCoderCRMDesignSystem_cdaf1f;
const { PIPELINE_STATES } = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;

function DealCard({ deal, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', padding: 12, cursor: 'pointer',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'box-shadow .18s ease-out, transform .12s ease-out',
        transform: hover ? 'translateY(-1px)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{deal.name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', marginTop: 2 }}>{deal.id}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          ${deal.amount.toLocaleString('es-ES')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{deal.prob}%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Avatar name={deal.contact} size="xs" />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{deal.contact}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="calendar" size={13} color="var(--text-tertiary)" />
          <span style={{ fontSize: 11, color: deal.due === 'Hoy' ? 'var(--color-warning-fg)' : 'var(--text-tertiary)', fontWeight: deal.due === 'Hoy' ? 600 : 400 }}>{deal.due}</span>
        </div>
      </div>
    </div>
  );
}

function Column({ stage, deals, onOpen }) {
  const s = PIPELINE_STATES[stage.key];
  const total = deals.reduce((a, d) => a + d.amount, 0);
  return (
    <div style={{ width: 264, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.dot }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{stage.label}</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>{deals.length}</span>
        </div>
        <Icon name="more" size={16} color="var(--text-tertiary)" />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', padding: '0 2px' }}>
        ${total.toLocaleString('es-ES')}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deals.map((d) => <DealCard key={d.id} deal={d} onClick={() => onOpen && onOpen(d)} />)}
        <button style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '9px', border: '1px dashed var(--color-border-strong)', background: 'transparent',
          borderRadius: 'var(--radius-md)', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 500,
          fontFamily: 'var(--font-sans)', cursor: 'pointer',
        }}>
          <Icon name="plus" size={15} color="var(--text-tertiary)" /> Añadir
        </button>
      </div>
    </div>
  );
}

function Pipeline({ data, onOpen }) {
  return (
    <div style={{ display: 'flex', gap: 18, overflowX: 'auto', paddingBottom: 8 }}>
      {data.stages.map((st) => (
        <Column key={st.key} stage={st} deals={data.deals.filter((d) => d.stage === st.key)} onOpen={onOpen} />
      ))}
    </div>
  );
}

window.Pipeline = Pipeline;
