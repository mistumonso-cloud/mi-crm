const { Card, Button, StatusBadge, Avatar, Tabs } = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;

function InfoRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
      <Icon name={icon} size={16} color="var(--text-tertiary)" />
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)', width: 64 }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function TimelineItem({ item, last }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 'var(--radius-full)', background: 'var(--color-accent-tint)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={item.icon} size={15} color="var(--color-accent)" />
        </div>
        {!last && <div style={{ width: 2, flex: 1, background: 'var(--color-border)', margin: '4px 0' }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 18, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{item.when}</span>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.detail}</span>
      </div>
    </div>
  );
}

function ContactDetail({ contact, onBack }) {
  const [tab, setTab] = React.useState('actividad');
  return (
    <div style={{ maxWidth: 920, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent',
        color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
        cursor: 'pointer', padding: 0, alignSelf: 'flex-start',
      }}>
        <Icon name="arrowLeft" size={16} color="var(--text-secondary)" /> Volver al pipeline
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left: identity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={contact.name} size="lg" />
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{contact.name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{contact.role}</div>
              </div>
            </div>
            <StatusBadge state={contact.stage} style={{ alignSelf: 'flex-start' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" full iconLeft={<Icon name="mail" size={15} color="#fff" />}>Email</Button>
              <Button variant="secondary" size="sm" full iconLeft={<Icon name="phone" size={15} color="var(--text-secondary)" />}>Llamar</Button>
            </div>
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 4 }}>
              <InfoRow icon="mail" label="Email" value={contact.email} />
              <InfoRow icon="phone" label="Tel" value={contact.phone} />
              <InfoRow icon="building" label="Empresa" value={contact.company} />
            </div>
          </Card>

          <Card padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Valor del negocio</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              ${contact.value.toLocaleString('es-ES')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{contact.since}</span>
          </Card>
        </div>

        {/* Right: timeline */}
        <Card padding="lg">
          <Tabs value={tab} onChange={setTab} style={{ marginBottom: 18 }} tabs={[
            { value: 'actividad', label: 'Actividad' },
            { value: 'notas', label: 'Notas' },
            { value: 'archivos', label: 'Archivos' },
          ]} />
          {tab === 'actividad' && (
            <div>
              {contact.timeline.map((it, i) => (
                <TimelineItem key={i} item={it} last={i === contact.timeline.length - 1} />
              ))}
            </div>
          )}
          {tab !== 'actividad' && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
              Sin {tab} todavía.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

window.ContactDetail = ContactDetail;
