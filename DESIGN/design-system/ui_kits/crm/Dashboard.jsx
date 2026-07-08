const { Card, Badge, StatusBadge, Avatar } = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;

function KpiCard({ kpi }) {
  return (
    <Card padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{kpi.label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{kpi.value}</span>
        <Badge tone={kpi.tone}>{kpi.delta}</Badge>
      </div>
    </Card>
  );
}

function ActivityRow({ a }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{
        width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--color-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name={a.icon} size={16} color="var(--text-secondary)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          <strong style={{ fontWeight: 600 }}>{a.who}</strong> {a.what}
        </span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{a.when}</span>
    </div>
  );
}

function Dashboard({ data, onOpenContact }) {
  const focus = data.deals.filter((d) => d.due === 'Hoy' || d.due === 'Mañana').slice(0, 4);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1080 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {data.kpis.map((k) => <KpiCard key={k.label} kpi={k} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <Card padding="lg">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Negocios que requieren acción</h2>
            <Icon name="trendingUp" size={18} color="var(--text-tertiary)" />
          </div>
          {focus.map((d) => (
            <div key={d.id} onClick={() => onOpenContact && onOpenContact(d)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0',
              borderBottom: '1px solid var(--color-border)', cursor: 'pointer',
            }}>
              <Avatar name={d.contact} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{d.contact} · {d.company}</div>
              </div>
              <StatusBadge state={d.stage} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', width: 78, textAlign: 'right' }}>
                ${d.amount.toLocaleString('es-ES')}
              </span>
              <span style={{ fontSize: 12, color: d.due === 'Hoy' ? 'var(--color-warning-fg)' : 'var(--text-tertiary)', width: 64, textAlign: 'right', fontWeight: d.due === 'Hoy' ? 600 : 400 }}>{d.due}</span>
            </div>
          ))}
        </Card>

        <Card padding="lg">
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Actividad reciente</h2>
          {data.activity.map((a, i) => <ActivityRow key={i} a={a} />)}
        </Card>
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
