/* @ds-bundle: {"format":3,"namespace":"VibeCoderCRMDesignSystem_cdaf1f","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"PIPELINE_STATES","sourcePath":"components/feedback/StatusBadge.jsx"},{"name":"StatusBadge","sourcePath":"components/feedback/StatusBadge.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"d5b0399dd86a","components/core/Button.jsx":"30d7ba7c3054","components/core/Card.jsx":"21fe5b0c9518","components/feedback/Badge.jsx":"66e914a9e3fd","components/feedback/StatusBadge.jsx":"3de8e22a12f3","components/forms/Checkbox.jsx":"007226b2a99a","components/forms/Input.jsx":"3d73a00aea07","components/forms/Select.jsx":"5fb0a62ac0db","components/forms/Switch.jsx":"300bd764bb2c","components/navigation/Tabs.jsx":"df9b7b1e415a","ui_kits/crm/AppShell.jsx":"def636767a15","ui_kits/crm/ContactDetail.jsx":"960ed12529b5","ui_kits/crm/Dashboard.jsx":"49275f0da504","ui_kits/crm/Login.jsx":"3e2ed1618d96","ui_kits/crm/Pipeline.jsx":"3f2eea12262b","ui_kits/crm/data.js":"fdcfbd7a4b3f","ui_kits/crm/icons.jsx":"8a9eb1e1a863"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VibeCoderCRMDesignSystem_cdaf1f = window.VibeCoderCRMDesignSystem_cdaf1f || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48
};
function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic muted tint from name — stays within the calm slate/neutral family.
const TINTS = [['#EAEFF3', '#3B5266'], ['#E0F2FE', '#0369A1'], ['#DCFCE7', '#15803D'], ['#FEF3C7', '#B45309'], ['#F3E8FF', '#7E22CE'], ['#F3F4F6', '#374151']];

/**
 * Avatar con iniciales (o imagen). Forma circular (radius.full).
 */
function Avatar({
  name = '',
  src = null,
  size = 'md',
  style = {},
  ...rest
}) {
  const px = typeof size === 'number' ? size : SIZES[size] ?? 40;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = hash * 31 + name.charCodeAt(i) >>> 0;
  const [bg, fg] = TINTS[hash % TINTS.length];
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      width: px,
      height: px,
      borderRadius: 'var(--radius-full)',
      background: src ? 'var(--color-muted)' : bg,
      color: fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      fontSize: Math.round(px * 0.38),
      lineHeight: 1,
      overflow: 'hidden',
      flexShrink: 0,
      userSelect: 'none',
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials(name));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    padding: '6px 10px',
    fontSize: 13,
    height: 32,
    radius: 'var(--radius-md)'
  },
  md: {
    padding: '9px 14px',
    fontSize: 14,
    height: 38,
    radius: 'var(--radius-md)'
  },
  lg: {
    padding: '11px 18px',
    fontSize: 15,
    height: 44,
    radius: 'var(--radius-md)'
  }
};
const VARIANTS = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--color-accent-contrast)',
    border: '1px solid transparent'
  },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-neutral-fg)',
    border: '1px solid var(--color-border)'
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-neutral-fg)',
    border: '1px solid transparent'
  },
  danger: {
    background: 'var(--color-danger)',
    color: '#fff',
    border: '1px solid transparent'
  }
};

/**
 * Botón de acción. Una sola acción primaria por pantalla.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  disabled = false,
  full = false,
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const hoverBg = {
    primary: 'var(--color-accent-hover)',
    secondary: 'var(--color-muted)',
    ghost: 'var(--color-muted)',
    danger: 'var(--color-danger-fg)'
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      width: full ? '100%' : 'auto',
      minHeight: s.height,
      padding: s.padding,
      fontSize: s.fontSize,
      fontWeight: 600,
      fontFamily: 'var(--font-sans)',
      lineHeight: 1,
      whiteSpace: 'nowrap',
      cursor: disabled ? 'not-allowed' : 'pointer',
      borderRadius: s.radius,
      transition: 'background .18s ease-out, transform .12s ease-out, box-shadow .18s ease-out',
      transform: active && !disabled ? 'scale(0.97)' : 'scale(1)',
      opacity: disabled ? 0.5 : 1,
      ...v,
      background: hover && !disabled ? hoverBg : v.background,
      ...style
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const PADS = {
  sm: 12,
  md: 16,
  lg: 20
};

/**
 * Contenedor de superficie: card blanca con borde hairline y sombra sutil.
 */
function Card({
  children,
  padding = 'md',
  interactive = false,
  selected = false,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pad = typeof padding === 'number' ? padding : PADS[padding] ?? 16;
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => interactive && setHover(true),
    onMouseLeave: () => interactive && setHover(false),
    style: {
      background: 'var(--color-surface)',
      border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-lg)',
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      padding: pad,
      cursor: interactive ? 'pointer' : 'default',
      transition: 'box-shadow .18s ease-out, border-color .18s ease-out',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  success: {
    bg: 'var(--color-success-bg)',
    fg: 'var(--color-success-fg)'
  },
  warning: {
    bg: 'var(--color-warning-bg)',
    fg: 'var(--color-warning-fg)'
  },
  danger: {
    bg: 'var(--color-danger-bg)',
    fg: 'var(--color-danger-fg)'
  },
  neutral: {
    bg: 'var(--color-neutral-bg)',
    fg: 'var(--color-neutral-fg)'
  },
  accent: {
    bg: 'var(--color-accent-tint)',
    fg: 'var(--color-accent)'
  }
};

/**
 * Badge semántico genérico (success / warning / danger / neutral / accent).
 * El color comunica estado, no decora.
 */
function Badge({
  children,
  tone = 'neutral',
  dot = false,
  style = {},
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1,
      padding: '5px 10px',
      borderRadius: 'var(--radius-full)',
      background: t.bg,
      color: t.fg,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: 'currentColor'
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// The 7 canonical pipeline states. dot = the saturated accent color for the left dot.
const PIPELINE_STATES = {
  lead: {
    label: 'Lead nuevo',
    bg: 'var(--status-lead-bg)',
    fg: 'var(--status-lead-fg)',
    dot: '#0EA5E9'
  },
  talking: {
    label: 'En conversación',
    bg: 'var(--status-talking-bg)',
    fg: 'var(--status-talking-fg)',
    dot: '#5B7387'
  },
  proposal: {
    label: 'Propuesta enviada',
    bg: 'var(--status-proposal-bg)',
    fg: 'var(--status-proposal-fg)',
    dot: '#A855F7'
  },
  negotiating: {
    label: 'Negociando',
    bg: 'var(--status-negotiating-bg)',
    fg: 'var(--status-negotiating-fg)',
    dot: '#F97316'
  },
  won: {
    label: 'Ganado',
    bg: 'var(--status-won-bg)',
    fg: 'var(--status-won-fg)',
    dot: '#22C55E'
  },
  lost: {
    label: 'Perdido',
    bg: 'var(--status-lost-bg)',
    fg: 'var(--status-lost-fg)',
    dot: '#EF4444'
  },
  inactive: {
    label: 'Inactivo',
    bg: 'var(--status-inactive-bg)',
    fg: 'var(--status-inactive-fg)',
    dot: '#9CA3AF'
  }
};

/**
 * Badge de estado del pipeline de ventas. Pill con punto de color a la izquierda.
 */
function StatusBadge({
  state = 'lead',
  label = null,
  dot = true,
  style = {},
  ...rest
}) {
  const s = PIPELINE_STATES[state] || PIPELINE_STATES.lead;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1,
      padding: '6px 12px',
      borderRadius: 'var(--radius-full)',
      background: s.bg,
      color: s.fg,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: s.dot,
      flexShrink: 0
    }
  }), label || s.label);
}
Object.assign(__ds_scope, { PIPELINE_STATES, StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Checkbox con label. Marcado usa el acento de marca.
 */
function Checkbox({
  checked = false,
  onChange,
  label = null,
  disabled = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      userSelect: 'none',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 18,
      height: 18,
      flexShrink: 0,
      borderRadius: 'var(--radius-sm)',
      border: `1.5px solid ${checked ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
      background: checked ? 'var(--color-accent)' : 'var(--color-surface)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background .15s ease-out, border-color .15s ease-out'
    }
  }, checked && /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#fff",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))), label);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Campo de texto con label, hint y estado de error opcionales.
 */
function Input({
  label = null,
  hint = null,
  error = null,
  prefix = null,
  suffix = null,
  size = 'md',
  style = {},
  containerStyle = {},
  disabled = false,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'sm' ? '7px 10px' : '10px 12px';
  const fontSize = size === 'sm' ? 13 : 14;
  const borderColor = error ? 'var(--color-danger)' : focus ? 'var(--color-accent)' : 'var(--color-border-strong)';
  const ring = error ? '0 0 0 3px rgba(239,68,68,.18)' : focus ? '0 0 0 3px rgba(59,82,102,.18)' : 'none';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      background: disabled ? 'var(--color-muted)' : 'var(--color-surface)',
      border: `1px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      padding: pad,
      boxShadow: ring,
      transition: 'border-color .18s ease-out, box-shadow .18s ease-out'
    }
  }, prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize,
      color: 'var(--text-primary)',
      minWidth: 0,
      ...style
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, suffix)), (error || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: error ? 'var(--color-danger-fg)' : 'var(--text-tertiary)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Select nativo estilizado con la misma estética que Input.
 * options: array de { value, label } o de strings.
 */
function Select({
  label = null,
  options = [],
  value,
  onChange,
  size = 'md',
  disabled = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'sm' ? '7px 10px' : '10px 12px';
  const fontSize = size === 'sm' ? 13 : 14;
  const norm = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      padding: pad,
      paddingRight: 34,
      fontFamily: 'var(--font-sans)',
      fontSize,
      color: 'var(--text-primary)',
      background: disabled ? 'var(--color-muted)' : 'var(--color-surface)',
      border: `1px solid ${focus ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focus ? '0 0 0 3px rgba(59,82,102,.18)' : 'none',
      outline: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'border-color .18s ease-out, box-shadow .18s ease-out',
      ...style
    }
  }, rest), norm.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--text-tertiary)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: 'absolute',
      right: 11,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Switch (toggle) on/off. Estado activo usa el acento de marca.
 */
function Switch({
  checked = false,
  onChange,
  label = null,
  disabled = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--text-primary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      userSelect: 'none',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 36,
      height: 20,
      flexShrink: 0,
      borderRadius: 'var(--radius-full)',
      background: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
      position: 'relative',
      transition: 'background .18s ease-out'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: 'var(--radius-full)',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(16,24,40,.2)',
      transition: 'left .18s ease-out'
    }
  })), label);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tabs subrayadas. tabs: array de { value, label } o strings.
 */
function Tabs({
  tabs = [],
  value,
  onChange,
  style = {},
  ...rest
}) {
  const norm = tabs.map(t => typeof t === 'string' ? {
    value: t,
    label: t
  } : t);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      gap: 4,
      borderBottom: '1px solid var(--color-border)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, rest), norm.map(t => {
    const active = t.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      type: "button",
      onClick: () => onChange && onChange(t.value),
      style: {
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        padding: '10px 12px',
        marginBottom: -1,
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: 600,
        color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
        borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
        cursor: 'pointer',
        transition: 'color .15s ease-out, border-color .15s ease-out'
      }
    }, t.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/AppShell.jsx
try { (() => {
const {
  Avatar
} = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;
const NAV = [{
  key: 'dashboard',
  label: 'Resumen',
  icon: 'dashboard'
}, {
  key: 'pipeline',
  label: 'Pipeline',
  icon: 'pipeline'
}, {
  key: 'contacts',
  label: 'Contactos',
  icon: 'contacts'
}, {
  key: 'tasks',
  label: 'Tareas',
  icon: 'tasks'
}, {
  key: 'settings',
  label: 'Ajustes',
  icon: 'settings'
}];
function NavItem({
  item,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '9px 10px',
      border: 'none',
      cursor: 'pointer',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontWeight: active ? 600 : 500,
      textAlign: 'left',
      color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
      background: active ? 'var(--color-accent-tint)' : hover ? 'var(--color-muted)' : 'transparent',
      transition: 'background .15s ease-out, color .15s ease-out'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon,
    size: 18,
    color: active ? 'var(--color-accent)' : 'var(--text-tertiary)'
  }), item.label);
}
function AppShell({
  active,
  onNav,
  title,
  action,
  children,
  user
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      background: 'var(--color-bg)',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 232,
      flexShrink: 0,
      background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 8px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 8,
      background: 'var(--color-accent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontWeight: 700,
      fontSize: 15
    }
  }, "V"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: 'var(--text-primary)'
    }
  }, "Vibe Coder"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 500,
      color: 'var(--text-tertiary)'
    }
  }, "CRM"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement(NavItem, {
    key: n.key,
    item: n,
    active: active === n.key,
    onClick: () => onNav(n.key)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 8,
      borderTop: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: user.name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      lineHeight: 1.3,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-primary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, user.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-tertiary)'
    }
  }, user.role)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      height: 60,
      flexShrink: 0,
      background: 'var(--color-surface)',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--text-primary)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: 'var(--color-muted)',
      borderRadius: 'var(--radius-md)',
      width: 220
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 16,
    color: "var(--text-tertiary)"
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Buscar negocios, contactos\u2026",
    style: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      flex: 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--text-primary)',
      minWidth: 0
    }
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 18,
    color: "var(--text-secondary)"
  })), action)), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 24
    }
  }, children)));
}
window.AppShell = AppShell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/ContactDetail.jsx
try { (() => {
const {
  Card,
  Button,
  StatusBadge,
  Avatar,
  Tabs
} = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;
function InfoRow({
  icon,
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 0'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: "var(--text-tertiary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-tertiary)',
      width: 64
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-primary)',
      fontWeight: 500
    }
  }, value));
}
function TimelineItem({
  item,
  last
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-full)',
      background: 'var(--color-accent-tint)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon,
    size: 15,
    color: "var(--color-accent)"
  })), !last && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 2,
      flex: 1,
      background: 'var(--color-border)',
      margin: '4px 0'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: last ? 0 : 18,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, item.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap'
    }
  }, item.when)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)',
      lineHeight: 1.5
    }
  }, item.detail)));
}
function ContactDetail({
  contact,
  onBack
}) {
  const [tab, setTab] = React.useState('actividad');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 920,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      border: 'none',
      background: 'transparent',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer',
      padding: 0,
      alignSelf: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrowLeft",
    size: 16,
    color: "var(--text-secondary)"
  }), " Volver al pipeline"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '300px 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: contact.name,
    size: "lg"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: 'var(--text-primary)'
    }
  }, contact.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, contact.role))), /*#__PURE__*/React.createElement(StatusBadge, {
    state: contact.stage,
    style: {
      alignSelf: 'flex-start'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    full: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 15,
      color: "#fff"
    })
  }, "Email"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    full: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "phone",
      size: 15,
      color: "var(--text-secondary)"
    })
  }, "Llamar")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--color-border)',
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(InfoRow, {
    icon: "mail",
    label: "Email",
    value: contact.email
  }), /*#__PURE__*/React.createElement(InfoRow, {
    icon: "phone",
    label: "Tel",
    value: contact.phone
  }), /*#__PURE__*/React.createElement(InfoRow, {
    icon: "building",
    label: "Empresa",
    value: contact.company
  }))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, "Valor del negocio"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: '-0.02em',
      color: 'var(--text-primary)'
    }
  }, "$", contact.value.toLocaleString('es-ES')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)'
    }
  }, contact.since))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    style: {
      marginBottom: 18
    },
    tabs: [{
      value: 'actividad',
      label: 'Actividad'
    }, {
      value: 'notas',
      label: 'Notas'
    }, {
      value: 'archivos',
      label: 'Archivos'
    }]
  }), tab === 'actividad' && /*#__PURE__*/React.createElement("div", null, contact.timeline.map((it, i) => /*#__PURE__*/React.createElement(TimelineItem, {
    key: i,
    item: it,
    last: i === contact.timeline.length - 1
  }))), tab !== 'actividad' && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '40px 0',
      textAlign: 'center',
      color: 'var(--text-tertiary)',
      fontSize: 14
    }
  }, "Sin ", tab, " todav\xEDa."))));
}
window.ContactDetail = ContactDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/ContactDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/Dashboard.jsx
try { (() => {
const {
  Card,
  Badge,
  StatusBadge,
  Avatar
} = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;
function KpiCard({
  kpi
}) {
  return /*#__PURE__*/React.createElement(Card, {
    padding: "md",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)',
      fontWeight: 500
    }
  }, kpi.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: '-0.02em',
      color: 'var(--text-primary)'
    }
  }, kpi.value), /*#__PURE__*/React.createElement(Badge, {
    tone: kpi.tone
  }, kpi.delta)));
}
function ActivityRow({
  a
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '11px 0',
      borderBottom: '1px solid var(--color-border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-muted)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.icon,
    size: 16,
    color: "var(--text-secondary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontWeight: 600
    }
  }, a.who), " ", a.what)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap'
    }
  }, a.when));
}
function Dashboard({
  data,
  onOpenContact
}) {
  const focus = data.deals.filter(d => d.due === 'Hoy' || d.due === 'Mañana').slice(0, 4);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      maxWidth: 1080
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16
    }
  }, data.kpis.map(k => /*#__PURE__*/React.createElement(KpiCard, {
    key: k.label,
    kpi: k
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 16,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, "Negocios que requieren acci\xF3n"), /*#__PURE__*/React.createElement(Icon, {
    name: "trendingUp",
    size: 18,
    color: "var(--text-tertiary)"
  })), focus.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.id,
    onClick: () => onOpenContact && onOpenContact(d),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid var(--color-border)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: d.contact,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, d.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)'
    }
  }, d.contact, " \xB7 ", d.company)), /*#__PURE__*/React.createElement(StatusBadge, {
    state: d.stage
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)',
      width: 78,
      textAlign: 'right'
    }
  }, "$", d.amount.toLocaleString('es-ES')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: d.due === 'Hoy' ? 'var(--color-warning-fg)' : 'var(--text-tertiary)',
      width: 64,
      textAlign: 'right',
      fontWeight: d.due === 'Hoy' ? 600 : 400
    }
  }, d.due)))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 4px',
      fontSize: 16,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, "Actividad reciente"), data.activity.map((a, i) => /*#__PURE__*/React.createElement(ActivityRow, {
    key: i,
    a: a
  })))));
}
window.Dashboard = Dashboard;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/Dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/Login.jsx
try { (() => {
const {
  Card,
  Button,
  Input
} = window.VibeCoderCRMDesignSystem_cdaf1f;
function Login({
  onLogin
}) {
  const [email, setEmail] = React.useState('lucia@vibecoder.app');
  const [pass, setPass] = React.useState('demo1234');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      fontFamily: 'var(--font-sans)',
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 360,
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 12,
      background: 'var(--color-accent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontWeight: 700,
      fontSize: 20
    }
  }, "V"), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: 'var(--text-primary)'
    }
  }, "Vibe Coder CRM"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: 'var(--text-secondary)',
      marginTop: 2
    }
  }, "Entra para gestionar tu pipeline"))), /*#__PURE__*/React.createElement(Card, {
    padding: "lg",
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value)
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Contrase\xF1a",
    type: "password",
    value: pass,
    onChange: e => setPass(e.target.value)
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    full: true,
    onClick: onLogin,
    style: {
      marginTop: 4
    }
  }, "Entrar"), /*#__PURE__*/React.createElement("button", {
    style: {
      border: 'none',
      background: 'transparent',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      cursor: 'pointer'
    }
  }, "\xBFOlvidaste tu contrase\xF1a?")), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      fontSize: 12,
      color: 'var(--text-tertiary)',
      margin: 0
    }
  }, "Demo \u2014 pulsa Entrar para explorar.")));
}
window.Login = Login;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/Login.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/Pipeline.jsx
try { (() => {
const {
  Card,
  Avatar
} = window.VibeCoderCRMDesignSystem_cdaf1f;
const {
  PIPELINE_STATES
} = window.VibeCoderCRMDesignSystem_cdaf1f;
const Icon = window.Icon;
function DealCard({
  deal,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 12,
      cursor: 'pointer',
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      transition: 'box-shadow .18s ease-out, transform .12s ease-out',
      transform: hover ? 'translateY(-1px)' : 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-primary)',
      lineHeight: 1.3
    }
  }, deal.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      marginTop: 2
    }
  }, deal.id)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 16,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: 'var(--text-primary)'
    }
  }, "$", deal.amount.toLocaleString('es-ES')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)'
    }
  }, deal.prob, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: deal.contact,
    size: "xs"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-secondary)'
    }
  }, deal.contact)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 13,
    color: "var(--text-tertiary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: deal.due === 'Hoy' ? 'var(--color-warning-fg)' : 'var(--text-tertiary)',
      fontWeight: deal.due === 'Hoy' ? 600 : 400
    }
  }, deal.due))));
}
function Column({
  stage,
  deals,
  onOpen
}) {
  const s = PIPELINE_STATES[stage.key];
  const total = deals.reduce((a, d) => a + d.amount, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 264,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 2px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: s.dot
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-primary)'
    }
  }, stage.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-tertiary)',
      fontWeight: 500
    }
  }, deals.length)), /*#__PURE__*/React.createElement(Icon, {
    name: "more",
    size: 16,
    color: "var(--text-tertiary)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-secondary)',
      padding: '0 2px'
    }
  }, "$", total.toLocaleString('es-ES')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, deals.map(d => /*#__PURE__*/React.createElement(DealCard, {
    key: d.id,
    deal: d,
    onClick: () => onOpen && onOpen(d)
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: '9px',
      border: '1px dashed var(--color-border-strong)',
      background: 'transparent',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-tertiary)',
      fontSize: 13,
      fontWeight: 500,
      fontFamily: 'var(--font-sans)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 15,
    color: "var(--text-tertiary)"
  }), " A\xF1adir")));
}
function Pipeline({
  data,
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      overflowX: 'auto',
      paddingBottom: 8
    }
  }, data.stages.map(st => /*#__PURE__*/React.createElement(Column, {
    key: st.key,
    stage: st,
    deals: data.deals.filter(d => d.stage === st.key),
    onOpen: onOpen
  })));
}
window.Pipeline = Pipeline;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/Pipeline.jsx", error: String((e && e.message) || e) }); }

// ui_kits/crm/data.js
try { (() => {
// Fake data for the Vibe Coder CRM UI kit. Not production — illustrative only.
window.CRM_DATA = {
  user: {
    name: 'Lucía Méndez',
    email: 'lucia@vibecoder.app',
    role: 'Ventas'
  },
  kpis: [{
    label: 'Ingresos del mes',
    value: '$48,200',
    delta: '+12%',
    tone: 'success'
  }, {
    label: 'Negocios abiertos',
    value: '23',
    delta: '+4',
    tone: 'accent'
  }, {
    label: 'Tasa de cierre',
    value: '34%',
    delta: '+3pts',
    tone: 'success'
  }, {
    label: 'Por vencer hoy',
    value: '5',
    delta: 'urgente',
    tone: 'warning'
  }],
  // Pipeline stages in order. state matches StatusBadge states.
  stages: [{
    key: 'lead',
    label: 'Lead nuevo'
  }, {
    key: 'talking',
    label: 'En conversación'
  }, {
    key: 'proposal',
    label: 'Propuesta enviada'
  }, {
    key: 'negotiating',
    label: 'Negociando'
  }, {
    key: 'won',
    label: 'Ganado'
  }],
  deals: [{
    id: 'VC-2048',
    name: 'Tienda Aurora',
    contact: 'Ana Torres',
    company: 'Aurora SL',
    amount: 12480,
    stage: 'negotiating',
    prob: 78,
    due: 'En 3 días'
  }, {
    id: 'VC-2051',
    name: 'Web Restaurante Sol',
    contact: 'Bruno Gil',
    company: 'Grupo Sol',
    amount: 6200,
    stage: 'proposal',
    prob: 55,
    due: 'Mañana'
  }, {
    id: 'VC-2052',
    name: 'App Reservas',
    contact: 'Carmen Ruiz',
    company: 'Bahía Tours',
    amount: 18900,
    stage: 'talking',
    prob: 30,
    due: 'En 5 días'
  }, {
    id: 'VC-2055',
    name: 'Landing Lanzamiento',
    contact: 'Diego Paz',
    company: 'Nova Labs',
    amount: 3400,
    stage: 'lead',
    prob: 15,
    due: 'Sin fecha'
  }, {
    id: 'VC-2056',
    name: 'Rediseño Catálogo',
    contact: 'Elena Soto',
    company: 'Mobel',
    amount: 9100,
    stage: 'won',
    prob: 100,
    due: 'Cerrado'
  }, {
    id: 'VC-2057',
    name: 'Integración Pagos',
    contact: 'Félix Romero',
    company: 'PayFlow',
    amount: 14200,
    stage: 'negotiating',
    prob: 64,
    due: 'Hoy'
  }, {
    id: 'VC-2059',
    name: 'Newsletter Setup',
    contact: 'Gabriela Lima',
    company: 'Verde Co.',
    amount: 2100,
    stage: 'talking',
    prob: 25,
    due: 'En 8 días'
  }, {
    id: 'VC-2061',
    name: 'Portal Clientes',
    contact: 'Hugo Vargas',
    company: 'Atlas',
    amount: 21500,
    stage: 'lead',
    prob: 10,
    due: 'Sin fecha'
  }, {
    id: 'VC-2062',
    name: 'Tienda Moda Fina',
    contact: 'Irene Castro',
    company: 'Hilo',
    amount: 7600,
    stage: 'proposal',
    prob: 48,
    due: 'En 2 días'
  }],
  activity: [{
    who: 'Ana Torres',
    what: 'respondió a tu propuesta',
    when: 'hace 12 min',
    icon: 'mail'
  }, {
    who: 'Félix Romero',
    what: 'pidió agendar una llamada',
    when: 'hace 1 h',
    icon: 'phone'
  }, {
    who: 'Elena Soto',
    what: 'firmó — negocio ganado',
    when: 'hace 3 h',
    icon: 'check'
  }, {
    who: 'Sistema',
    what: 'recordatorio: 5 tareas vencen hoy',
    when: 'hace 5 h',
    icon: 'bell'
  }],
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
    timeline: [{
      icon: 'mail',
      title: 'Propuesta enviada',
      detail: 'Plan Pro anual · $18,900',
      when: '2 jul'
    }, {
      icon: 'phone',
      title: 'Llamada de descubrimiento',
      detail: '32 min · necesita migrar antes de Q3',
      when: '28 jun'
    }, {
      icon: 'note',
      title: 'Nota',
      detail: 'Prefiere pago trimestral. Decisor único.',
      when: '27 jun'
    }, {
      icon: 'zap',
      title: 'Lead creado',
      detail: 'Origen: formulario web',
      when: '24 jun'
    }]
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/data.js", error: String((e && e.message) || e) }); }

// ui_kits/crm/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Lucide icon path data (ISC-licensed, lucide.dev) — the closest match to the
// Linear/Notion minimalist stroke aesthetic this brand references. 24x24, stroke 2.
const PATHS = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  pipeline: ['M6 5v11', 'M12 5v6', 'M18 5v14', 'M3 5h6v0', 'M9 5h6', 'M15 5h6'],
  contacts: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  search: ['M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'M21 21l-4.35-4.35'],
  plus: ['M12 5v14', 'M5 12h14'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  chevronRight: ['M9 18l6-6-6-6'],
  chevronDown: ['M6 9l6 6 6-6'],
  phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 7l-10 6L2 7'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 6h18v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 10h18'],
  more: ['M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  trendingUp: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
  building: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01', 'M9 18v.01'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54z'],
  check: ['M20 6L9 17l-5-5'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  note: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z']
};
function Icon({
  name,
  size = 20,
  color = 'currentColor',
  strokeWidth = 2,
  style = {},
  ...rest
}) {
  const d = PATHS[name];
  if (!d) return null;
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: 'block',
      flexShrink: 0,
      ...style
    }
  }, rest), d.map((p, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: p
  })));
}
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/crm/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.PIPELINE_STATES = __ds_scope.PIPELINE_STATES;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
