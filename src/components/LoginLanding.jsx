import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Mail, Lock, User, GraduationCap, ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import Swal from 'sweetalert2';

export default function LoginLanding({ onLoginTeacher, onLoginStudent }) {
  const [view, setView] = useState('selection'); // selection, teacher_login, student_login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // --- MODO SALVAVIDAS (DEMO) ---
    // Si el internet de la escuela falla o bloquea Supabase, este usuario siempre entrará
    if (email === 'admin@utc.edu.mx' && password === 'tesis2026') {
      toast("Entrando en Modo Administrador (Bypass local)", { icon: '🛡️' });
      setLoading(false);
      if (onLoginTeacher) onLoginTeacher({ id: 'admin-bypass', email: 'admin@utc.edu.mx' });
      return;
    }

    try {
      const esDocente = view === 'teacher_login';

      if (esDocente) {
        if (isRegistering) {
          const { data, error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          toast.success("Registro exitoso. Bienvenido a Centinela IA");
          setIsRegistering(false); 
        } else {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (onLoginTeacher) onLoginTeacher(data.user); 
        }
      } else {
        // Lógica de Alumno
        if (isRegistering) {
          if (!name.trim()) throw new Error('El Nombre Completo es obligatorio.');
          const { error } = await supabase.from('alumnos').insert([{
            nombre_completo: name,
            correo: email,
            matricula: password
          }]);
          if (error) {
            if (error.code === '23505') throw new Error('La matrícula o correo ya están registrados.');
            throw new Error(error.message);
          }
          
          localStorage.setItem('centinela_user', JSON.stringify({
            nombre: name,
            correo: email,
            matricula: password
          }));

          toast.success("Registro exitoso. Bienvenido a Centinela IA");
          setIsRegistering(false);
        } else {
          // 1. Validar en Supabase si el alumno tiene un registro de expulsión activo
          const { data: expulsionRecord, error: checkError } = await supabase
            .from('commands')
            .select('id')
            .eq('matricula', password) 
            .eq('command', 'EXPULSAR');

          if (checkError) {
            console.error("Error al verificar estado del alumno:", checkError);
            throw new Error("No se pudo verificar el estado del alumno. Intenta de nuevo.");
          }

          // 2. Si la base de datos devuelve un registro de expulsión, aplicar el portazo
          if (expulsionRecord && expulsionRecord.length > 0) {
            Swal.fire({
              title: 'Acceso Denegado',
              text: 'Tu examen ha sido cancelado por el docente y no puedes reingresar.',
              icon: 'error',
              confirmButtonColor: '#991b1b',
              confirmButtonText: 'Entendido'
            });
            
            // Abortar la función para que no avance a la siguiente pantalla
            return; 
          }

          const { data: alumnoData, error: alumnoError } = await supabase.from('alumnos')
            .select('*')
            .eq('matricula', password)
            .maybeSingle();
            
          if (alumnoError || !alumnoData) {
            throw new Error('Matrícula no encontrada. Por favor, regístrate primero.');
          }
          
          if (alumnoData.correo !== email) {
            throw new Error('El correo no coincide con la matrícula ingresada.');
          }

          // Registrar sesión en exam_sessions
          const { error: sessionError } = await supabase.from('exam_sessions').insert([{
            pin_sala: roomCode,
            student_name: alumnoData.nombre_completo,
            matricula_alumno: alumnoData.matricula
          }]);
          
          if (sessionError) {
            console.error("No se pudo registrar en exam_sessions:", sessionError);
            // Opcional: throw new Error("No se pudo registrar la sesión.");
          }

          if (onLoginStudent) {
            onLoginStudent({ 
              email: alumnoData.correo,
              matricula: alumnoData.matricula,
              nombre_completo: alumnoData.nombre_completo,
              roomCode: roomCode
            });
          }
        }
      }
    } catch (err) {
      // --- MANEJO DE ERRORES AMPLIADO ---
      if (err.message.includes('Invalid login credentials')) {
        setError("Correo o contraseña incorrectos.");
      } else if (err.message.includes('rate limit')) {
        setError("Has intentado muchas veces. Espera un minuto o usa el usuario administrador.");
      } else {
        setError("Error: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-neutral-900 font-sans flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="p-3 bg-black rounded-2xl mb-4 shadow-sm">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Centinela IA</h1>
          <p className="text-sm text-neutral-500">Supervisión inteligente de evaluaciones</p>
        </div>

        <div>
          {view === 'selection' && (
            <div className="space-y-4">
              <button
                onClick={() => setView('teacher_login')}
                className="w-full flex items-center justify-between p-6 bg-white border border-neutral-200 rounded-2xl hover:border-black transition-all group shadow-sm"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="p-2 bg-neutral-100 rounded-lg group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Portal Docente</h3>
                    <p className="text-xs text-neutral-500">Administra tus exámenes y monitorea alertas.</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-black transform group-hover:translate-x-1 transition-all" />
              </button>

              <button
                onClick={() => setView('student_login')}
                className="w-full flex items-center justify-between p-6 bg-white border border-neutral-200 rounded-2xl hover:border-black transition-all group shadow-sm"
              >
                <div className="flex items-center gap-4 text-left">
                  <div className="p-2 bg-neutral-100 rounded-lg group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Portal Alumno</h3>
                    <p className="text-xs text-neutral-500">Ingresa a tu evaluación supervisada.</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-black transform group-hover:translate-x-1 transition-all" />
              </button>
            </div>
          )}

          {(view === 'teacher_login' || view === 'student_login') && (
            <div className="bg-white p-8 rounded-2xl border border-neutral-200 shadow-sm">
              <button 
                onClick={() => { setView('selection'); setIsRegistering(false); setError(null); }}
                className="flex items-center gap-2 text-xs font-medium text-neutral-500 hover:text-black mb-6 transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
                Volver
              </button>

              <h2 className="text-lg font-bold mb-1 transition-all">
                {view === 'teacher_login' 
                  ? (isRegistering ? 'Crear Cuenta Docente' : 'Bienvenido, Docente') 
                  : (isRegistering ? 'Registro de Alumno' : 'Acceso a Examen')}
              </h2>
              <p className="text-xs text-neutral-500 mb-8 transition-all">
                {view === 'teacher_login' 
                  ? (isRegistering ? 'Regístrate para gestionar tus evaluaciones.' : 'Introduce tus credenciales para continuar.') 
                  : (isRegistering ? 'Crea tu cuenta para poder presentar evaluaciones.' : 'Ingresa tus datos para comenzar la evaluación.')}
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold uppercase tracking-tight flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                {view === 'student_login' && isRegistering && (
                  <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">Nombre Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                      <input 
                        type="text" 
                        required={isRegistering && view === 'student_login'}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                        placeholder="Ej. Juan Pérez"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">Correo Institucional</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      type="email" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder="usuario@universidad.edu"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">
                    {view === 'teacher_login' ? 'Contraseña' : 'Matrícula'}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <input 
                      type={view === 'teacher_login' ? 'password' : 'text'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder={view === 'teacher_login' ? '••••••••' : 'Tu Matrícula'}
                    />
                  </div>
                </div>

                {view === 'student_login' && !isRegistering && (
                  <div className="space-y-1 animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest px-1">PIN de Sala</label>
                    <input 
                      type="text" 
                      required={!isRegistering && view === 'student_login'}
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-black tracking-widest focus:outline-none focus:ring-1 focus:ring-black focus:border-black transition-all"
                      placeholder="MAT-101"
                    />
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-black text-white rounded-xl text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mt-4"
                >
                  {loading 
                    ? 'Validando...' 
                    : (isRegistering 
                        ? 'Registrarse' 
                        : (view === 'teacher_login' ? 'Entrar al Panel Docente' : 'Entrar al Examen'))}
                </button>

                {(view === 'teacher_login' || view === 'student_login') && (
                  <div className="mt-4 text-center animate-in fade-in duration-500">
                    <button 
                      type="button" 
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="text-xs text-blue-600 hover:underline font-bold transition-all"
                    >
                      {isRegistering ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                    </button>
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
