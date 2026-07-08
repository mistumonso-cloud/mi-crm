const { Card, Button, Input } = window.VibeCoderCRMDesignSystem_cdaf1f;

function Login({ onLogin }) {
  const [email, setEmail] = React.useState('lucia@vibecoder.app');
  const [pass, setPass] = React.useState('demo1234');
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)', fontFamily: 'var(--font-sans)', padding: 24,
    }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20,
          }}>V</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>Vibe Coder CRM</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>Entra para gestionar tu pipeline</div>
          </div>
        </div>
        <Card padding="lg" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Contraseña" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          <Button variant="primary" size="lg" full onClick={onLogin} style={{ marginTop: 4 }}>Entrar</Button>
          <button style={{
            border: 'none', background: 'transparent', color: 'var(--text-secondary)',
            fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer',
          }}>¿Olvidaste tu contraseña?</button>
        </Card>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
          Demo — pulsa Entrar para explorar.
        </p>
      </div>
    </div>
  );
}

window.Login = Login;
