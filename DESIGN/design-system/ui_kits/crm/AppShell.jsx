const { Avatar } = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;

const NAV = [
  { key: 'dashboard', label: 'Resumen', icon: 'dashboard' },
  { key: 'pipeline', label: 'Pipeline', icon: 'pipeline' },
  { key: 'contacts', label: 'Contactos', icon: 'contacts' },
  { key: 'tasks', label: 'Tareas', icon: 'tasks' },
  { key: 'settings', label: 'Ajustes', icon: 'settings' },
];

function NavItem({ item, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 10px', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)',
        fontSize: 14, fontWeight: active ? 600 : 500, textAlign: 'left',
        color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
        background: active ? 'var(--color-accent-tint)' : (hover ? 'var(--color-muted)' : 'transparent'),
        transition: 'background .15s ease-out, color .15s ease-out',
      }}
    >
      <Icon name={item.icon} size={18} color={active ? 'var(--color-accent)' : 'var(--text-tertiary)'} />
      {item.label}
    </button>
  );
}

function AppShell({ active, onNav, title, action, children, user }) {
  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--color-bg)', fontFamily: 'var(--font-sans)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 232, flexShrink: 0, background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column',
        padding: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 14px' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 15,
          }}>V</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>Vibe Coder</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)' }}>CRM</span>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((n) => (
            <NavItem key={n.key} item={n} active={active === n.key} onClick={() => onNav(n.key)} />
          ))}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderTop: '1px solid var(--color-border)' }}>
          <Avatar name={user.name} size="sm" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{user.role}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{
          height: 60, flexShrink: 0, background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', padding: '0 24px',
        }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: 'var(--color-muted)', borderRadius: 'var(--radius-md)', width: 220,
            }}>
              <Icon name="search" size={16} color="var(--text-tertiary)" />
              <input placeholder="Buscar negocios, contactos…" style={{
                border: 'none', outline: 'none', background: 'transparent', flex: 1,
                fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--text-primary)', minWidth: 0,
              }} />
            </div>
            <button style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
              <Icon name="bell" size={18} color="var(--text-secondary)" />
            </button>
            {action}
          </div>
        </header>
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

window.AppShell = AppShell;
