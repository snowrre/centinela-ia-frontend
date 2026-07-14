import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, AlertCircle, AlertTriangle,
  Users, BarChart3, Search, Settings,
  Sun, Moon, Presentation, LogOut, PlusSquare, Trash2,
  Activity, Video, Clock, ChevronRight, Mic,
  MonitorSmartphone, Laptop
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';
import LoginLanding from './components/LoginLanding';
import MarketingLanding from './components/MarketingLanding';
import MagicExamCreator from './components/MagicExamCreator';
import StudentPortal from './components/StudentPortal';
import AdminDashboard from './components/AdminDashboard';
import BiometricAuth from './components/BiometricAuth';
import ProcesarPago from './components/ProcesarPago';
import { useBiometric } from './context/BiometricContext';
import { Toaster } from 'react-hot-toast';
import { useDeviceRestriction } from './hooks/useDeviceRestriction';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState(() => {
    if (window.location.pathname === '/exito') {
      return 'exito';
    }
    // Si venimos de Stripe (después del pago), mostramos el componente de procesamiento
    if (new URLSearchParams(window.location.search).get('session_id')) {
      return 'procesar_pago';
    }
    return 'marketing';
  });
  const [teacherTab, setTeacherTab] = useState(() => localStorage.getItem('centinela_tab') || 'monitor');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('centinela_dark') === 'true');

  // ── Restricción de dispositivo móvil ─────────────────────────────────────
  // Se evalúa UNA sola vez al montar. isChecking evita un flash del contenido
  // mientras la detección corre (es síncrona, pero React batchea el primer render).
  const { isMobile, isChecking } = useDeviceRestriction();

  // Contexto biométrico — para limpiar el rostroMaestro en logout
  const { clearBiometric } = useBiometric();

  useEffect(() => {
    localStorage.setItem('centinela_tab', teacherTab);
    localStorage.setItem('centinela_dark', darkMode);
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [teacherTab, darkMode]);

  const [studentData, setStudentData] = useState(() => {
    const session = localStorage.getItem('centinela_session');
    try { return session ? JSON.parse(session) : null; } catch(e) { return null; }
  });

  const handleLogout = () => {
    setView('landing');
    setStudentData(null);
    clearBiometric(); // Limpiar descriptor facial en memoria al cerrar sesión
    // Ghost-Session Fix: borrar la sesión del localStorage para que el ex-alumno
    // no quede "fantasma" disparando alertas desde el Login si vuelve a la app.
    localStorage.removeItem('centinela_session');
  };

  // ── PANTALLA DE BLOQUEO: Dispositivo no permitido ───────────────────────
  // Se muestra antes de cualquier otra vista para que el alumno nunca vea
  // ni un frame del contenido del examen desde su teléfono.
  if (isChecking) {
    // Pantalla en blanco mínima mientras se detecta el dispositivo.
    // Dura <1ms en la práctica (es código síncrono), pero evita el flash.
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />
    );
  }

  if (isMobile) {
    return <MobileBlockScreen />;
  }

  if (view === 'exito') {
    return <Exito />;
  }

  if (view === 'marketing') {
    return <MarketingLanding onGoToLogin={() => setView('landing')} />;
  }

  if (view === 'procesar_pago') {
    const pendingClientId = localStorage.getItem('centinela_pending_client_id');
    return (
      <ProcesarPago 
        clientId={pendingClientId} 
        onVerificationSuccess={(datos) => {
          // Limpiar estado temporal y limpiar URL sin recargar
          localStorage.removeItem('centinela_pending_client_id');
          window.history.replaceState({}, document.title, window.location.pathname.split('?')[0]);
          // Mandamos al usuario al login (o directamente al dashboard si estuviera auto-logueado)
          setView('landing');
        }} 
      />
    );
  }

  if (view === 'landing') {
    return (
      <LoginLanding 
        onLoginTeacher={() => setView('teacher_dashboard')} 
        onLoginStudent={async (data) => {
          setStudentData(data);
          // ── NUEVO: ir a verificación biométrica ANTES del portal del alumno ──
          setView('biometric_auth');

          // Guardar sesión en localStorage para persistencia
          const sessionData = {
            ...data,
            timestamp: new Date().toISOString()
          };
          localStorage.setItem('centinela_session', JSON.stringify(sessionData));

          // Registrar la conexión en Supabase
          try {
            await supabase.from('camera_logs').insert([{
              pin_sala: data.roomCode || data.pin,
              event_type: 'CONEXIÓN_ACTIVA',
              description: 'El alumno ha ingresado a la sala y está activo.',
              matricula: data.matricula,
              nombre_completo: data.matricula,
              created_at: new Date().toISOString()
            }]);
          } catch(err) {
            console.error('Error registrando conexión:', err);
          }
        }} 
      />
    );
  }

  // ── NUEVA VISTA: Prueba de Vida Biométrica ────────────────────────────────
  if (view === 'biometric_auth') {
    return (
      <BiometricAuth
        darkMode={darkMode}
        studentInfo={studentData}
        onSuccess={() => {
          // Prueba de vida superada → continuar al portal del examen
          setView('student_dashboard');
        }}
        onError={(err) => {
          console.error('[App] Error en BiometricAuth:', err);
          // En caso de error irrecuperable, volver al login
          // (el componente ya muestra el mensaje de error con opción de recargar)
        }}
      />
    );
  }

  if (view === 'student_dashboard') {
    return <StudentPortal onExit={handleLogout} darkMode={darkMode} studentData={studentData} />;
  }

  return (
    <div className={cn("min-h-screen flex transition-colors duration-300", darkMode ? "bg-surf-dark text-white" : "bg-[#f8f9fa] text-neutral-900")}>
      <Toaster 
        position="top-center"
        toastOptions={{
          className: '!rounded-2xl !shadow-lg !font-bold text-sm tracking-tight',
          style: {
            background: darkMode ? '#111' : '#fff',
            color: darkMode ? '#fff' : '#000',
            border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.05)',
            padding: '16px 24px',
          }
        }}
      />
      {/* Sidebar */}
      <aside className={cn("w-72 border-r flex flex-col transition-all duration-500", darkMode ? "border-white/10 bg-[#050505]" : "border-neutral-200 bg-white")}>
        <div className="p-10 flex items-center gap-4">
          <div className="p-2.5 bg-blue-600 rounded-2xl shadow-xl shadow-blue-600/20">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-black tracking-tighter uppercase text-black dark:text-white">Centinela IA</h1>
        </div>

        <nav className="flex-1 px-6 py-4 space-y-2">
          <SidebarItem active={teacherTab === 'monitor'} onClick={() => setTeacherTab('monitor')} icon={<BarChart3 className="w-4 h-4" />} label="Monitoreo" dark={darkMode} />
          <SidebarItem active={teacherTab === 'creator'} onClick={() => setTeacherTab('creator')} icon={<PlusSquare className="w-4 h-4" />} label="Crear Examen" dark={darkMode} />
          <SidebarItem icon={<Users className="w-4 h-4" />} label="Estudiantes" dark={darkMode} />
          <SidebarItem icon={<Settings className="w-4 h-4" />} label="Ajustes" dark={darkMode} />
        </nav>

        <div className="p-8 border-t dark:border-white/10">
          <button onClick={handleLogout} className="w-full flex items-center gap-4 px-6 py-4 text-neutral-400 hover:text-red-500 transition-colors font-black text-xs uppercase tracking-widest">
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className={cn("h-28 border-b flex items-center justify-between px-12 transition-all duration-500", darkMode ? "border-white/10 bg-[#050505]/50 backdrop-blur-3xl" : "border-neutral-200 bg-white/50 backdrop-blur-3xl")}>
          <div className="relative w-[450px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input type="text" placeholder="Buscar por PIN o Matrícula..." className={cn("w-full pl-14 pr-6 py-4 rounded-[24px] text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-600/50", darkMode ? "bg-white/5 border-white/10 text-white" : "bg-neutral-100 border-transparent text-neutral-900")} />
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setDarkMode(!darkMode)} className={cn("p-4 rounded-[22px] border transition-all hover:scale-105 active:scale-95 shadow-sm", darkMode ? "border-white/10 bg-white/5 text-yellow-400" : "border-neutral-200 bg-white text-blue-600")}>
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className="w-12 h-12 rounded-[22px] bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-xl shadow-blue-600/20 flex items-center justify-center font-black text-white text-xs">AD</div>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {teacherTab === 'monitor' && <AdminDashboard darkMode={darkMode} />}
          {teacherTab === 'creator' && <MagicExamCreator darkMode={darkMode} onComplete={() => setTeacherTab('monitor')} />}
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, dark }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-5 px-8 py-5 rounded-[22px] transition-all font-black text-[13px] uppercase tracking-tighter", 
      active ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : (dark ? "text-neutral-500 hover:bg-white/5 hover:text-white" : "text-neutral-400 hover:bg-neutral-100 hover:text-black"))}>
      {icon}
      {label}
    </button>
  );
}

// ── PANTALLA DE BLOQUEO PARA DISPOSITIVOS MÓVILES ────────────────────────────
// Componente independiente para que App() no incluya su JSX en el bundle crítico.
function MobileBlockScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0f0f1a 50%, #0a0a0a 100%)',
        padding: '24px',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Glow de fondo decorativo */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(239,68,68,0.08) 0%, transparent 70%)',
      }} />

      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: '28px',
        padding: '48px 36px',
        textAlign: 'center',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 0 60px rgba(239,68,68,0.08), 0 32px 64px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>

        {/* Ícono principal */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '80px',
          height: '80px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.05))',
          border: '1px solid rgba(239,68,68,0.3)',
          marginBottom: '28px',
          boxShadow: '0 0 40px rgba(239,68,68,0.15)',
        }}>
          <MonitorSmartphone size={38} color="#f87171" strokeWidth={1.5} />
        </div>

        {/* Badge de estado */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '100px',
          padding: '6px 16px',
          marginBottom: '20px',
        }}>
          <div style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: '#ef4444',
            boxShadow: '0 0 8px #ef4444',
            animation: 'pulse 2s infinite',
          }} />
          <span style={{ color: '#f87171', fontSize: '11px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Acceso Denegado
          </span>
        </div>

        {/* Título */}
        <h1 style={{
          color: '#ffffff',
          fontSize: '22px',
          fontWeight: 900,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          marginBottom: '12px',
        }}>
          Dispositivo no compatible
        </h1>

        {/* Mensaje principal */}
        <p style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: '14px',
          lineHeight: 1.6,
          marginBottom: '32px',
        }}>
          El sistema de supervisión biométrica <strong style={{ color: 'rgba(255,255,255,0.75)' }}>Centinela IA</strong> requiere acceso desde una computadora de escritorio o laptop con cámara web.
        </p>

        {/* Separador */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent)',
          marginBottom: '28px',
        }} />

        {/* Requisito visual */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '16px 20px',
          textAlign: 'left',
        }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0,
            background: 'rgba(59,130,246,0.15)',
            border: '1px solid rgba(59,130,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Laptop size={22} color="#60a5fa" strokeWidth={1.5} />
          </div>
          <div>
            <p style={{ color: '#ffffff', fontSize: '13px', fontWeight: 700, marginBottom: '2px' }}>
              Usa tu computadora
            </p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', lineHeight: 1.4 }}>
              Abre esta misma URL en Chrome o Firefox desde tu laptop o PC de escritorio.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p style={{
          color: 'rgba(255,255,255,0.2)',
          fontSize: '11px',
          marginTop: '28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}>
          <ShieldAlert size={12} />
          Procesamiento biométrico local · Sin almacenamiento de imágenes
        </p>
      </div>

      {/* Keyframe para el punto pulsante — inyectado inline */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function Exito() {
  return (
    <div style={{ textAlign: 'center', padding: '50px', color: 'white', background: '#0a0a0a', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>¡Pago Aprobado! ✅</h1>
      <p style={{ marginBottom: '30px' }}>Bienvenido a Centinela IA. Tu Licencia Campus ha sido activada.</p>
      <a href="/" style={{ padding: '10px 20px', background: '#2563eb', color: 'white', borderRadius: '8px', textDecoration: 'none', fontWeight: 'bold' }}>Volver al inicio</a>
    </div>
  );
}

