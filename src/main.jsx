import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BiometricProvider } from './context/BiometricContext.jsx'

// ── NOTA ARQUITECTÓNICA ────────────────────────────────────────────────────────
// ⚠️  React.StrictMode DESACTIVADO intencionalmente.
//
// En desarrollo, StrictMode monta y desmonta cada componente DOS VECES en el
// mismo milisegundo para detectar efectos secundarios. Para apps normales es
// inofensivo, pero para @tensorflow/tfjs-backend-wasm es letal:
//
//   Error: "Multiple volume of Wasm sessions is not supported"
//
// El motor WASM es un singleton de memoria compartida (SharedArrayBuffer).
// No admite dos instancias concurrentes bajo ninguna circunstancia. El doble
// montaje de StrictMode dispara dos llamadas a Human.load() en paralelo →
// la segunda chocha contra la sesión de la primera → pánico → fallback CDN
// → toda la pipeline de inferencia colapsa.
//
// Solución: eliminar StrictMode. Los bugs reales de efectos secundarios en
// este proyecto ya están mitigados con los guards explícitos:
//   • `let cancelled = true` en cada useEffect de bootstrap
//   • `let active = true`    en el useEffect del RAF loop
//   • `successRef`           como guard atómico de un solo disparo
// ──────────────────────────────────────────────────────────────────────────────
//
// Listeners globales (visibilitychange / fullscreenchange) también fueron
// eliminados de aquí — viven correctamente dentro de StudentPortal.jsx
// con cleanup automático al desmontar. Sin fantasmas. Sin falsos positivos.
// ──────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')).render(
  // BiometricProvider envuelve toda la app para compartir el rostroMaestro
  <BiometricProvider>
    <App />
  </BiometricProvider>,
)
