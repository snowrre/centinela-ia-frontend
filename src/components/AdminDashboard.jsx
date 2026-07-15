import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldAlert, AlertCircle, AlertTriangle,
  Users, Presentation, Activity, Video, Clock, ChevronRight, Mic, Trash2, Folder, Loader2
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import 'jspdf-autotable';


function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function AdminDashboard({ darkMode }) {
  const [logs, setLogs] = useState([]);
  const [activeExams, setActiveExams] = useState([]);
  const [studentStatus, setStudentStatus] = useState({});
  const [filterPin, setFilterPin] = useState(null);
  const [deletingPin, setDeletingPin] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, isAll: false, message: '' });
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [blockedStudents, setBlockedStudents] = useState([]);
  // ── Telemetría Biométrica en Tiempo Real ─────────────────────────────────
  const [alertasBio, setAlertasBio] = useState([]);



  const showToast = (message, type = 'success') => {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: type === 'error' ? 'error' : 'success',
      title: message,
      showConfirmButton: false,
      timer: 3000
    });
  };

  // Función para buscar quién está en la lista negra
  const fetchBlockedStudents = async () => {
    const { data, error } = await supabase
      .from('commands')
      .select('matricula, id')
      .eq('command', 'EXPULSAR');
      
    if (!error && data) {
      // Filtrar duplicados por si acaso
      const uniqueStudents = Array.from(new Set(data.map(a => a.matricula)))
        .map(mat => data.find(a => a.matricula === mat));
      setBlockedStudents(uniqueStudents);
    }
  };

  const fetchData = async () => {
    try {
      // 0. IDENTIFICAR AL PROFESOR ACTUAL
      // Usamos la sesión activa en Supabase para obtener el ID único del profesor
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
          console.error("No se detectó una sesión de usuario activa.");
          return;
      }
      const idProfesorActual = user.id;

      // 1. OBTENER SALAS ACTIVAS (Filtro por profesor)
      // Agregamos el candado .eq('id_profesor', idProfesorActual)
      const { data: examData, error: examError } = await supabase
        .from('exams')
        .select('id, pin_sala, titulo, tipo, created_at')
        .eq('id_profesor', idProfesorActual) 
        .order('created_at', { ascending: false });
      
      const localExams = JSON.parse(localStorage.getItem('active_exams') || '[]');
      
      // Combinar y eliminar duplicados por PIN
      const combined = [...(examData || [])].map(e => ({
        ...e,
        pin_sala: e.pin_sala,
        titulo: e.titulo
      }));
      
      localExams.forEach(local => {
        if (!combined.find(e => e.pin === local.pin || e.pin_sala === local.pin_sala)) {
          combined.push(local);
        }
      });
      
      // Filtro del cementerio
      const graveyard = JSON.parse(localStorage.getItem('examenes_eliminados') || '[]');
      const filteredExams = combined.filter(e => !graveyard.includes(String(e.pin || e.pin_sala)));

      // Guardamos las salas que SÍ son de este profesor
      setActiveExams(filteredExams);

      // 2. OBTENER ALUMNOS EN LÍNEA Y ENTREGAS (Solo de las salas activas de este profesor)
      const misPinesDeSala = filteredExams.map(e => String(e.pin || e.pin_sala));

      let logData = [];
      let subData = [];
      
      // Si el profesor tiene salas activas, buscamos las cámaras y entregas de esas salas
      if (misPinesDeSala.length > 0) {
          const { data: logs } = await supabase
            .from('camera_logs')
            .select('*')
            .in('pin_sala', misPinesDeSala) // <--- CANDADO 2: Solo trae logs de TUS PINs
            .order('created_at', { ascending: false })
            .limit(100);
          
          logData = logs || [];

          // Agregamos también el filtrado de entregas
          const { data: subs } = await supabase
            .from('exam_submissions')
            .select('*')
            .in('exam_pin', misPinesDeSala)
            .order('created_at', { ascending: false });
          subData = subs || [];
      }
      
      setLogs(logData);
      setSubmissions(subData);

      const status = {};
      logData.forEach(log => {
        if (!status[log.matricula]) {
          status[log.matricula] = {
            nombre: log.nombre_completo,
            matricula: log.matricula,
            ultimo_evento: log.event_type,
            fecha: log.created_at,
            alerta: log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso') || log.event_type?.includes('GAZE') || log.event_type?.includes('rostros') || log.event_type?.includes('Celular'),
            pin_sala: log.pin_sala,
            lastUpdate: Date.now()
          };
        }
      });
      
      // Guardamos el estado de los alumnos filtrados
      setStudentStatus(status);

      if (examError) console.warn("Note: Could not fetch all exams from DB, using local cache.");
    } catch (error) {
      console.error("Error inesperado al cargar los datos del panel:", error);
      const localExams = JSON.parse(localStorage.getItem('active_exams') || '[]');
      const graveyard = JSON.parse(localStorage.getItem('examenes_eliminados') || '[]');
      setActiveExams(localExams.filter(e => !graveyard.includes(String(e.pin || e.pin_sala))));
    }
  };

  const promptClearRoom = () => {
    setConfirmModal({
      isOpen: true,
      isAll: false,
      message: '¿Eliminar todos los registros de esta sala? Esta acción borrará las alertas y sesiones de la base de datos de forma permanente.'
    });
  };

  const promptClearAll = () => {
    setConfirmModal({
      isOpen: true,
      isAll: true,
      message: '¿Eliminar todos los registros? Esta acción borrará las alertas y sesiones de la base de datos de forma permanente.'
    });
  };

  const executeClearAction = async () => {
    const isAll = confirmModal.isAll;

    // Si hay una sala filtrada activa y se eligió limpiar sala (isAll = false)
    if (!isAll && filterPin) {
      try {
        const pin = String(filterPin);

        const { error: errorLogs } = await supabase.from('camera_logs').delete().eq('pin_sala', pin);
        const { error: errorSessions } = await supabase.from('exam_sessions').delete().eq('pin_sala', pin);

        if (errorLogs || errorSessions) {
          console.error("Error al limpiar sala", errorLogs || errorSessions);
          showToast('No se pudo limpiar la sala. Revisa la consola.', 'error');
          return;
        }

        setLogs([]);
        setStudentStatus({});
        showToast('Historial limpiado correctamente.', 'success');
      } catch (error) {
        console.error('Error al limpiar sala:', error);
        showToast('No se pudo limpiar la sala. Revisa la consola.', 'error');
      }
      return;
    }

    // Limpiar TODAS las salas
    try {
      // Borrar todos los registros de la base de datos de forma segura
      const { error: errorLogs } = await supabase
        .from('camera_logs')
        .delete()
        .not('pin_sala', 'is', null);

      const { error: errorSessions } = await supabase
        .from('exam_sessions')
        .delete()
        .not('pin_sala', 'is', null);

      if (errorLogs || errorSessions) {
        console.error("Error al limpiar base de datos", errorLogs || errorSessions);
        showToast("Error al limpiar la base de datos.", "error");
        return;
      }

      setLogs([]);
      setStudentStatus({});
      setFilterPin(null);

      showToast('Historial limpiado correctamente.', 'success');
    } catch (error) {
      console.error('Error al limpiar salas:', error);
      showToast('Ocurrió un error al limpiar. Revisa la consola.', 'error');
    }
  };

  const handleKickStudent = async (matricula) => {
    // 1. Animación bonita de confirmación
    const result = await Swal.fire({
      title: '¿Expulsar a este alumno?',
      text: `Estás a punto de eliminar a ${matricula}. Su acceso será revocado.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      // 2. Ejecutar base de datos
      await supabase.from('camera_logs').insert([{ matricula, tipo: 'EXPULSION_MANUAL', descripcion: 'Expulsado por el docente' }]);
      await supabase.from('commands').insert([{ matricula, command: 'EXPULSAR', payload: { message: 'Expulsado' } }]);

      // 3. Notificación visual de éxito (El aviso que el profesor necesita ver)
      Swal.fire({
        title: '¡Eliminado!',
        text: `El alumno ${matricula} ya no está en el examen.`,
        icon: 'success',
        timer: 3000,
        showConfirmButton: false
      });

      // 4. Actualizar la lista negra automáticamente
      fetchBlockedStudents();

    } catch (error) {
      console.error(error);
      Swal.fire('Error', 'Fallo de conexión.', 'error');
    }
  };

  const handleUnbanStudent = async (matricula) => {
    const result = await Swal.fire({
      title: '¿Habilitar examen?',
      text: `Permitirás que ${matricula} vuelva a ingresar al sistema.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#10B981',
      cancelButtonColor: '#6B7280',
      confirmButtonText: 'Sí, habilitar',
      cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
      await supabase
        .from('commands')
        .delete()
        .eq('matricula', matricula)
        .eq('command', 'EXPULSAR');

      fetchBlockedStudents();

      Swal.fire({
        title: 'Habilitado',
        text: `El alumno ${matricula} ya puede ingresar de nuevo.`,
        icon: 'success',
        timer: 3000,
        toast: true,
        position: 'top-end',
        showConfirmButton: false
      });
    } catch (error) {
      console.error("Error al habilitar:", error);
      Swal.fire('Error', 'No se pudo comunicar con la base de datos.', 'error');
    }
  };

  const handleDeleteExam = async (pinToDelete) => {
    setDeletingPin(null);

    try {
      // 1. Ejecuta la promesa primero. Bloqueo de actualización optimista.
      const { error } = await supabase.from('exams').delete().eq('pin_sala', pinToDelete);
      
      if (error) {
        console.error("Error de Supabase:", error);
        showToast('Error al eliminar. Revisa la consola.', 'error');
        return;
      }

      // Borrar de forma asíncrona de otras tablas si la principal tuvo éxito
      await supabase.from('camera_logs').delete().eq('pin_sala', pinToDelete);
      await supabase.from('exam_submissions').delete().eq('exam_pin', pinToDelete);

      // SOLO si no hay error, actualizar el estado
      setActiveExams(prev => prev.filter(exam =>
        String(exam.pin) !== String(pinToDelete) &&
        String(exam.pin_sala) !== String(pinToDelete)
      ));
      if (filterPin === pinToDelete) setFilterPin(null);

      // Limpiar localStorage y cementerio
      const local = JSON.parse(localStorage.getItem('active_exams') || '[]');
      localStorage.setItem('active_exams', JSON.stringify(
        local.filter(e => String(e.pin || e.pin_sala) !== String(pinToDelete))
      ));
      const graveyard = JSON.parse(localStorage.getItem('examenes_eliminados') || '[]');
      if (!graveyard.includes(String(pinToDelete))) {
        graveyard.push(String(pinToDelete));
        localStorage.setItem('examenes_eliminados', JSON.stringify(graveyard));
      }

      showToast('Examen eliminado correctamente.', 'success');
    } catch (err) {
      console.error('Error al eliminar sala:', err);
      showToast('Error al eliminar. Revisa la consola.', 'error');
    }
  };

  const handleDeleteAllExams = async () => {
    try {
      // Bloqueo de actualización optimista
      const { error } = await supabase.from('exams').delete().not('created_at', 'is', null);
      
      if (error) {
        console.error("Error de Supabase:", error);
        showToast('Error al eliminar. Revisa la consola.', 'error');
        return;
      }

      // Limpiar logs relacionados sin bloquear
      await supabase.from('camera_logs').delete().not('created_at', 'is', null);
      await supabase.from('exam_submissions').delete().not('created_at', 'is', null);

      // SOLO si no hay error, actualizar el estado
      setActiveExams([]);
      setFilterPin(null);
      localStorage.setItem('active_exams', '[]');
      
      showToast('Todos los exámenes han sido eliminados.', 'success');
    } catch (err) {
      console.error('Error de Supabase:', err);
      showToast('Error al eliminar. Revisa la consola.', 'error');
    }
  };

  useEffect(() => {
    fetchData();

    // Suscripción Realtime a entregas de exámenes
    const subChannel = supabase
      .channel('submissions-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'exam_submissions' },
        (payload) => {
          setSubmissions(prev => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subChannel);
    };
  }, []);

  // Suscripción Realtime independiente para la Lista Negra
  useEffect(() => {
    // 1. Carga inicial de los alumnos bloqueados
    fetchBlockedStudents();

    // 2. Canal de escucha en tiempo real para la tabla 'commands'
    const commandsSubscription = supabase
      .channel('realtime-blacklist')
      .on(
        'postgres_changes',
        {
          event: '*', // Escuchar INSERTs (expulsiones nuevas) y DELETEs (perdones)
          schema: 'public',
          table: 'commands'
        },
        (payload) => {
          // 3. Cuando ocurra un cambio, volver a traer la lista actualizada
          console.log('Cambio detectado en la lista negra, actualizando en tiempo real...');
          fetchBlockedStudents();
        }
      )
      .subscribe();

    // 4. Limpiar la suscripción si el componente se desmonta
    return () => {
      supabase.removeChannel(commandsSubscription);
    };
  }, []); // Array vacío: solo se suscribe una vez al montar

  // ── Suscripción Realtime: telemetria_examenes (Monitor Biométrico) ────────
  useEffect(() => {
    // 1. Cargar historial inicial de alertas biométricas del día
    const fetchAlertasBio = async () => {
      const { data } = await supabase
        .from('telemetria_examenes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (data) setAlertasBio(data);
    };
    fetchAlertasBio();

    // 2. WebSocket en tiempo real — sólo INSERTs de fraude nuevo
    const alertasChannel = supabase
      .channel('monitor-docente')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetria_examenes',
        },
        (payload) => {
          console.log('🚨 ¡Alerta biométrica en tiempo real!', payload.new);

          // Inyectar al frente de la lista
          setAlertasBio((prev) => [payload.new, ...prev].slice(0, 50));

          // Beep de alerta al docente
          try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
              const ctx = new AudioContext();
              // Doble tono urgente para alertas biométricas
              [520, 680].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
                gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.18);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.25);
                osc.start(ctx.currentTime + i * 0.18);
                osc.stop(ctx.currentTime + i * 0.18 + 0.25);
              });
            }
          } catch (_) {}
        }
      )
      .subscribe();

    // 3. Cleanup al desmontar el panel
    return () => {
      supabase.removeChannel(alertasChannel);
    };
  }, []);

  // Suscripción Realtime a la tabla de logs filtrada por sala actual
  useEffect(() => {
    let filterString = undefined;
    if (filterPin) {
      filterString = `pin_sala=eq.${filterPin}`;
    }

    const channel = supabase
      .channel(`camera_logs_changes_${filterPin || 'all'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'camera_logs', filter: filterString },
        (payload) => {
          const log = payload.new;


          // Sonido breve de notificación (beep) para alertar al docente
          try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc.start();
                osc.stop(ctx.currentTime + 0.3);
            }
          } catch(e) {}

          setLogs(prev => [log, ...prev].slice(0, 100));
          setStudentStatus(prev => ({
            ...prev,
            [log.matricula]: {
              nombre: log.nombre_completo,
              matricula: log.matricula,
              ultimo_evento: log.event_type,
              fecha: log.created_at,
              alerta: log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso') || log.event_type?.includes('GAZE') || log.event_type?.includes('rostros') || log.event_type?.includes('Celular'),
              pin_sala: log.pin_sala,
              lastUpdate: Date.now()
            }
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterPin]);

  // ── Generación de Reporte PDF ────────────────────────────────────────────────
  const handleExportPDF = () => {
    // ── Guardia de validación: abortar si no hay datos que exportar ───────────
    if (logs.length === 0 && blockedStudents.length === 0) {
      Swal.fire({
        title: 'Historial Vacío',
        text: 'No hay alertas ni alumnos bloqueados para generar un reporte en este momento.',
        icon: 'info',
        confirmButtonColor: '#3b82f6',
        confirmButtonText: 'Entendido'
      });
      return; // Abortar la generación del PDF
    }

    const doc = new jsPDF();

    // Encabezado del documento
    doc.setFontSize(20);
    doc.setTextColor(220, 38, 38); // Rojo oscuro
    doc.text('Centinela IA - Reporte de Incidencias', 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(
      `Fecha de evaluación: ${new Date().toLocaleDateString()} a las ${new Date().toLocaleTimeString()}`,
      14, 30
    );

    // SECCIÓN 1: Tabla de Alertas
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text('1. Registro de Alertas y Telemetría', 14, 45);

    const alertsData = logs.map(alerta => [
      alerta.matricula || '-',
      alerta.event_type || 'Infracción',
      new Date(alerta.created_at).toLocaleTimeString()
    ]);

    doc.autoTable({
      startY: 50,
      head: [['Matrícula', 'Tipo de Incidencia', 'Hora Detectada']],
      body: alertsData.length > 0 ? alertsData : [['-', 'No se registraron alertas', '-']],
      theme: 'striped',
      headStyles: { fillColor: [220, 38, 38] }, // Rojo
      styles: { fontSize: 10 }
    });

    // SECCIÓN 2: Tabla de Alumnos Expulsados (Lista Negra)
    const finalY = doc.lastAutoTable.finalY || 50;

    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text('2. Alumnos Expulsados (Bloqueo de Sesión)', 14, finalY + 15);

    const blockedData = blockedStudents.map(student => [
      student.matricula,
      'ACCESO DENEGADO'
    ]);

    doc.autoTable({
      startY: finalY + 20,
      head: [['Matrícula', 'Estado Actual']],
      body: blockedData.length > 0 ? blockedData : [['-', 'Ningún alumno expulsado']],
      theme: 'striped',
      headStyles: { fillColor: [17, 24, 39] }, // Negro/Gris muy oscuro
      styles: { fontSize: 10 }
    });

    doc.save('Centinela_IA_Reporte_Oficial.pdf');
  };

  // Agrupamiento para estadísticas de gráficas de barras
  const alertStats = useMemo(() => {
    const stats = {};
    let total = 0;
    logs.forEach(log => {
        let type = 'Otros';
        if (log.event_type?.includes('Celular')) type = 'Celulares';
        else if (log.event_type?.includes('rostros')) type = 'Múltiples Rostros';
        else if (log.event_type?.includes('MIRADA')) type = 'Desvío de Mirada';
        else if (log.event_type?.includes('AUSENCIA')) type = 'Ausencia';
        else if (log.event_type?.includes('OBJETO')) type = 'Objetos Prohibidos';

        stats[type] = (stats[type] || 0) + 1;
        total++;
    });
    return { stats, total };
  }, [logs]);

  return (
    <div className="p-12 space-y-12">


      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <KpiCard
          title="Alertas Críticas"
          value={
            logs.filter(l =>
              l.event_type?.includes('OBJETO') || l.event_type?.includes('sospechoso') ||
              l.event_type?.includes('rostros') || l.event_type?.includes('Celular')
            ).length + alertasBio.length
          }
          icon={<AlertCircle className="w-6 h-6 text-red-500" />}
          dark={darkMode}
          color="red"
          badge={alertasBio.length > 0 ? `+${alertasBio.length} bio` : null}
        />
        <KpiCard title="Avisos Sistema" value={logs.filter(l => l.event_type?.includes('MIRADA') || l.event_type?.includes('AUSENCIA')).length} icon={<AlertTriangle className="w-6 h-6 text-yellow-500" />} dark={darkMode} color="yellow" />
        <KpiCard title="Alumnos en Línea" value={Object.keys(studentStatus).length} icon={<Users className="w-6 h-6 text-blue-500" />} dark={darkMode} color="blue" />
        <KpiCard title="Salas Activas" value={activeExams.length} icon={<Presentation className="w-6 h-6 text-purple-500" />} dark={darkMode} color="purple" />
      </div>

      {/* SECCIÓN DE ESTADÍSTICAS - NUEVO */}
      <div className={cn("p-10 rounded-[40px] border", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
        <div className="flex items-center gap-3 mb-8">
            <Activity className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Distribución de Alertas</h3>
        </div>
        
        {alertStats.total > 0 ? (
            <div className="space-y-6">
                {Object.entries(alertStats.stats).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const percentage = Math.round((count / alertStats.total) * 100);
                    return (
                        <div key={type} className="flex flex-col gap-2">
                            <div className="flex justify-between text-xs font-bold uppercase tracking-wide">
                                <span>{type}</span>
                                <span className="text-neutral-400">{percentage}% ({count})</span>
                            </div>
                            <div className="w-full h-3 rounded-full bg-neutral-100 dark:bg-white/5 overflow-hidden">
                                <div 
                                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-1000"
                                    style={{ width: `${percentage}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        ) : (
            <div className="text-center py-10 text-neutral-400 font-bold uppercase tracking-widest text-xs">No hay datos suficientes para graficar</div>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500 flex items-center gap-3">
                <Activity className="w-4 h-4 text-blue-600" /> 
                {filterPin ? `Monitoreando Sala: ${filterPin}` : "Mapeo de Señales en Vivo"}
            </h3>
            <div className="flex gap-4">
              {filterPin && (
                <button 
                  onClick={() => setFilterPin(null)}
                  className="px-4 py-1.5 rounded-full bg-neutral-100 dark:bg-white/10 text-[10px] font-black uppercase tracking-widest border dark:border-white/10 hover:bg-neutral-200 dark:hover:bg-white/20 transition-all"
                >
                  Ver Todos
                </button>
              )}
              <span className="px-4 py-1.5 rounded-full bg-blue-600/10 text-blue-600 text-[10px] font-black uppercase tracking-widest animate-pulse border border-blue-600/20">Sincronizado</span>
            </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {Object.values(studentStatus)
            .filter(student => !filterPin || student.pin_sala === filterPin)
            .map(student => (
            <div key={student.matricula} className={cn("p-8 rounded-[40px] border group transition-all hover:shadow-2xl relative", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
              {/* Visualización de Cámara en Vivo */}
              <div className="relative aspect-video rounded-3xl overflow-hidden mb-6 bg-neutral-900 shadow-inner group-hover:shadow-2xl transition-all duration-500">
                <img 
                  src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/snapshots/${student.matricula}.jpg?t=${student.lastUpdate}`}
                  className="w-full h-full object-cover"
                  alt="Live feed"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="hidden absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-500 gap-2">
                  <Video className="w-6 h-6 opacity-20" />
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Sin Señal</span>
                </div>
                
                {/* Overlay Indicators */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                  <div className="flex gap-1.5">
                    {student.alerta && (
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                    )}
                    <div className="px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg text-[8px] font-black text-white uppercase tracking-widest border border-white/10">
                      LIVE
                    </div>
                  </div>
                  {student.ultimo_evento?.includes('AUDIO') && (
                    <div className="p-1.5 bg-red-600 rounded-lg shadow-lg">
                      <Mic className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xs", student.alerta ? "bg-red-500 text-white" : "bg-blue-600 text-white shadow-lg shadow-blue-600/20")}>
                      {student.nombre?.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-black uppercase tracking-tight truncate">{student.nombre}</h4>
                    <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">{student.matricula}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                   <button 
                      onClick={async () => {
                        const { error } = await supabase.from('commands').insert({
                          target_matricula: student.matricula,
                          command_type: 'WARNING',
                          message: "Por favor, mantén la vista al frente y no uses el celular.",
                          status: 'pending'
                        });
                        if (!error) toast.success("Advertencia enviada");
                      }}
                      className="p-2 bg-yellow-500/10 text-yellow-600 rounded-xl hover:bg-yellow-500 hover:text-white transition-all shadow-sm" title="Enviar Advertencia">
                      <ShieldAlert className="w-3.5 h-3.5" />
                   </button>
                   <button 
                      onClick={async () => {
                        if(confirm(`¿Expulsar a ${student.nombre}?`)) {
                          await supabase.from('commands').insert({
                            matricula: student.matricula,
                            command: 'EXPULSAR'
                          });
                        }
                      }}
                      className="p-2 bg-red-500/10 text-red-600 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-sm" title="Expulsar Estudiante">
                      <Trash2 className="w-3.5 h-3.5" />
                   </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className={cn("px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border", 
                      student.alerta ? "bg-red-600 text-white border-red-400" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20")}>
                        {student.ultimo_evento?.replace('_', ' ') || 'Normal'}
                    </span>
                    <span className="text-[9px] px-3 py-1.5 bg-neutral-100 dark:bg-white/5 rounded-full text-neutral-400 font-black uppercase tracking-widest border dark:border-white/5">{student.pin_sala}</span>
                </div>
                
                <div className="pt-6 border-t dark:border-white/5 mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest">{new Date(student.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <button 
                      onClick={() => {
                        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/snapshots/${student.matricula}.jpg?t=${Date.now()}`;
                        window.open(url, '_blank');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg shadow-blue-600/20">
                      Ampliar <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
              </div>
            </div>
          ))}
          {Object.keys(studentStatus).length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed rounded-[40px] border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-white/5">
                <Users className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                <p className="text-xs font-black text-neutral-400 uppercase tracking-widest">Esperando conexión de alumnos...</p>
            </div>
          )}
        </div>
      </div>

      {/* ── PANEL MONITOR BIOMÉTRICO EN TIEMPO REAL ────────────────────────── */}
      <div className={cn("rounded-[40px] border overflow-hidden", darkMode ? "bg-[#111111] border-red-500/20" : "bg-white border-red-100 shadow-xl")}>
        <div className="p-8 border-b dark:border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Activity className="w-4 h-4 text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.25em] text-neutral-800 dark:text-white">
                  🧬 Monitor Biométrico
                </h3>
                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-0.5">
                  telemetria_examenes · WebSocket activo
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {alertasBio.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-red-500 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-500/30 animate-pulse">
                  {alertasBio.length} evento{alertasBio.length !== 1 ? 's' : ''}
                </span>
              )}
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-black uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                En Vivo
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto max-h-[480px] p-6 space-y-3">
          {alertasBio.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 opacity-30">
              <ShieldAlert className="w-10 h-10 mb-3" strokeWidth={1.5} />
              <p className="text-xs font-black uppercase tracking-widest">Sin alertas biométricas</p>
              <p className="text-[10px] text-neutral-500 mt-1">Las alertas aparecerán aquí en tiempo real</p>
            </div>
          ) : (
            alertasBio.map((alerta) => {
              const cfg = getBioAlertConfig(alerta.tipo_anomalia);
              const conf = Math.round((alerta.nivel_confianza || 0) * 100);
              return (
                <div
                  key={alerta.id}
                  className={cn(
                    'group p-4 rounded-2xl border-l-[6px] flex items-start gap-4 transition-all duration-300 hover:scale-[1.01]',
                    cfg.border, cfg.bg
                  )}
                >
                  <div className="text-2xl shrink-0 mt-0.5 drop-shadow-sm select-none">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className={cn('font-extrabold text-sm uppercase tracking-wide leading-tight', cfg.text)}>
                        {cfg.label}
                      </h4>
                      <span className="text-[10px] font-mono text-neutral-500 bg-white dark:bg-white/10 px-2 py-0.5 rounded-lg shadow-sm border dark:border-white/10 shrink-0">
                        {new Date(alerta.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-white dark:bg-white/10 text-neutral-800 dark:text-neutral-200 border dark:border-white/10 shadow-sm">
                        👤 {alerta.estudiante_id}
                      </span>
                      {conf > 0 && (
                        <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border', cfg.badgeBg, cfg.badgeText, cfg.badgeBorder)}>
                          Confianza: {conf}%
                        </span>
                      )}
                    </div>
                    {/* Barra de confianza */}
                    {conf > 0 && (
                      <div className="mt-2 h-1.5 w-full rounded-full bg-neutral-100 dark:bg-white/5 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-700', cfg.barColor)}
                          style={{ width: `${conf}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Exámenes Activos</h3>
                <button 
                  onClick={() => setConfirmModal({
                      isOpen: true,
                      isDeleteAllExams: true,
                      message: '¿Eliminar TODOS los exámenes? Esta acción es irreversible y borrará todas las salas creadas.'
                  })}
                  className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white"
                  title="Borrar Todos los Exámenes"
                >
                  Borrar Todos
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {activeExams.map(exam => (
                    <div key={exam.id} className={cn("p-10 rounded-[40px] border group transition-all hover:shadow-2xl", darkMode ? "bg-[#111111] border-white/10 hover:border-blue-500/50" : "bg-white border-neutral-200")}>
                        <div className="flex items-center justify-between mb-10">
                            <div className="px-6 py-2 bg-blue-600 text-white text-[10px] font-black rounded-2xl uppercase tracking-[0.2em] shadow-lg shadow-blue-600/20">{exam.pin || exam.pin_sala || "SIN PIN"}</div>
                            <div className="flex gap-2">
                                <button 
                                    type="button"
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setDeletingPin(exam.pin || exam.pin_sala || exam.id); 
                                        setConfirmModal({
                                            isOpen: true,
                                            isDeleteExam: true,
                                            message: '¿Eliminar este examen? Esta acción es irreversible y borrará la sala por completo.'
                                        });
                                    }}
                                    className="p-3 rounded-2xl bg-red-500 text-white shadow-lg shadow-red-500/20 transition-all hover:scale-110 active:scale-95 cursor-pointer"
                                    title="Eliminar Sala"
                                >
                                    <Trash2 className="w-5 h-5 pointer-events-none" />
                                </button>
                            </div>
                        </div>
                        <h4 className="text-xl font-black mb-2 uppercase tracking-tight">{exam.titulo}</h4>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mb-10">Creado: {new Date(exam.created_at).toLocaleDateString()}</p>
                        
                        <div className="flex items-center justify-between">
                            <div className="flex -space-x-3">
                                {[1,2,3].map(i => <div key={i} className="w-10 h-10 rounded-2xl bg-neutral-200 dark:bg-neutral-800 border-4 border-white dark:border-[#111111]" />)}
                            </div>
                            <button 
                              onClick={() => {
                                setFilterPin(exam.pin_sala);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className={cn("px-6 py-2 rounded-2xl text-[10px] font-black uppercase transition-all", 
                                filterPin === exam.pin_sala ? "bg-blue-600 text-white shadow-lg" : "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20")}
                            >
                              {filterPin === exam.pin_sala ? "Gestionando..." : "Gestionar Sala"}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            
            {activeExams.length === 0 && (
                <div className={cn("p-16 rounded-[40px] border-2 border-dashed flex flex-col items-center justify-center text-center transition-all", darkMode ? "border-white/10 bg-white/5" : "border-neutral-200 bg-neutral-50")}>
                    <div className={cn("w-20 h-20 rounded-full flex items-center justify-center mb-6", darkMode ? "bg-[#111111] text-neutral-500" : "bg-white text-neutral-300 shadow-xl")}>
                        <Folder className="w-10 h-10" strokeWidth={1.5} />
                    </div>
                    <h4 className="text-sm font-black uppercase tracking-widest text-neutral-500 mb-2">Aún no hay exámenes activos</h4>
                    <p className="text-xs font-bold text-neutral-400">¡Crea el primero desde el panel de docente!</p>
                </div>
            )}
        </div>

        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Alertas Recientes</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-lg shadow transition-colors text-[10px] uppercase tracking-widest"
                    title="Exportar reporte completo en PDF"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Exportar PDF
                  </button>
                  <button 
                    onClick={filterPin ? promptClearRoom : promptClearAll} 
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm",
                      filterPin
                        ? "bg-red-600 text-white hover:bg-red-700 shadow-red-600/20"
                        : "bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
                    )}
                    title={filterPin ? `Limpiar historial sala ${filterPin}` : 'Limpiar todo el historial'}
                  >
                    {filterPin ? `🗑 Limpiar Sala ${filterPin}` : 'Limpiar Historial'}
                  </button>
                </div>
            </div>
            <div className={cn("rounded-[40px] border overflow-hidden flex flex-col h-[600px]", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {logs.map(log => {
                        const isCritical = log.event_type === 'CRITICO' || log.event_type === 'CRÍTICO'
                          || log.event_type?.includes('OBJETO') || log.event_type?.includes('sospechoso')
                          || log.event_type?.includes('rostros') || log.event_type?.includes('Celular')
                          || log.event_type?.includes('CRITICO');
                        const isWarning = !isCritical && (
                          log.event_type?.includes('Aviso') || log.event_type?.includes('AVISO')
                          || log.event_type?.includes('AUSENCIA') || log.event_type?.includes('MIRADA')
                          || log.event_type?.includes('ABANDONO') || log.event_type?.includes('FULLSCREEN')
                        );
                        const icon = isCritical ? '🚨' : isWarning ? '⚠️' : 'ℹ️';
                        const borderColor = isCritical
                          ? 'border-l-red-600'
                          : isWarning
                            ? 'border-l-yellow-500'
                            : 'border-l-blue-500';
                        const bgColor = isCritical
                          ? (darkMode ? 'bg-red-950/40' : 'bg-red-50')
                          : isWarning
                            ? (darkMode ? 'bg-yellow-950/30' : 'bg-yellow-50')
                            : (darkMode ? 'bg-blue-950/20' : 'bg-blue-50');
                        const titleColor = isCritical
                          ? 'text-red-500'
                          : isWarning
                            ? 'text-yellow-600'
                            : 'text-blue-600';
                        return (
                          <div
                            key={log.id}
                            className={cn(
                              'p-4 rounded-2xl border-l-8 shadow-sm flex items-start gap-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-md border border-transparent',
                              borderColor, bgColor
                            )}
                          >
                            {/* Ícono dinámico */}
                            <div className="text-3xl drop-shadow-sm mt-0.5 select-none shrink-0">{icon}</div>

                            {/* Contenido */}
                            <div className="flex-1 min-w-0">
                              {/* Header: tipo + timestamp */}
                              <div className="flex justify-between items-start mb-1 gap-2">
                                <h4 className={cn('font-extrabold text-sm uppercase tracking-wide leading-tight', titleColor)}>
                                  {log.event_type?.replace(/_/g, ' ')}
                                </h4>
                                <span className="text-[10px] font-mono text-neutral-500 bg-white dark:bg-white/10 px-2 py-0.5 rounded shadow-sm border dark:border-white/10 shrink-0">
                                  {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>

                              {/* Descripción */}
                              <p className="text-xs text-neutral-600 dark:text-neutral-300 font-medium mb-2 leading-snug">
                                {log.description || 'Sin descripción adicional.'}
                              </p>

                              {/* Badge alumno */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold bg-white dark:bg-white/10 text-neutral-800 dark:text-neutral-200 border dark:border-white/10 shadow-sm">
                                  👤 {log.nombre_completo || log.matricula || 'Alumno desconocido'}
                                </span>
                                {log.pin_sala && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-black bg-white dark:bg-white/5 text-neutral-500 border dark:border-white/10 shadow-sm uppercase tracking-widest">
                                    Sala {log.pin_sala}
                                  </span>
                                )}
                              </div>
                              
                              {/* Botón de Expulsión contextual — aparece en críticos Y en abandonos/fullscreen */}
                              {(isCritical || isWarning) && log.matricula && (
                                <button
                                  onClick={() => confirmKick(log.matricula)}
                                  className="mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-semibold rounded-lg shadow-md hover:shadow-red-500/40 hover:shadow-lg transform transition-all duration-200 hover:scale-[1.03] active:scale-95 border border-red-400/30"
                                >
                                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                                  </svg>
                                  Expulsar Alumno
                                </button>
                              )}
                            </div>
                          </div>
                        );
                    })}
                    {logs.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 italic py-20">
                            <Clock className="w-8 h-8 mb-2" />
                            <span className="text-xs font-black uppercase tracking-widest">Sin registros</span>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* PANEL DE ALUMNOS BLOQUEADOS */}
        <div className={cn("rounded-[40px] border overflow-hidden p-8 mt-2", darkMode ? "bg-[#111111] border-red-500/20" : "bg-white border-red-100 shadow-xl")}>
          <h3 className={cn("text-sm font-black uppercase tracking-[0.3em] flex items-center gap-3 mb-6", darkMode ? "text-red-400" : "text-red-700")}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Alumnos Bloqueados
          </h3>

          {blockedStudents.length === 0 ? (
            <p className="text-neutral-400 text-xs font-bold uppercase tracking-widest italic text-center py-6">
              No hay alumnos bloqueados actualmente.
            </p>
          ) : (
            <div className="space-y-3">
              {blockedStudents.map((student) => (
                <div key={student.id} className={cn("flex items-center justify-between p-4 rounded-2xl border", darkMode ? "bg-red-950/30 border-red-500/20" : "bg-red-50 border-red-100")}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-red-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                    <span className={cn("font-mono font-black text-sm", darkMode ? "text-red-300" : "text-red-900")}>
                      {student.matricula}
                    </span>
                  </div>
                  <button
                    onClick={() => handleUnbanStudent(student.matricula)}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-emerald-500/20 transition-all hover:scale-105 active:scale-95"
                  >
                    Habilitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>


      </div>

      {filterPin && (
        <div className="mt-12 space-y-8">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-neutral-500">Resultados del Examen</h3>
            <div className={cn("rounded-[40px] border overflow-hidden", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-xl")}>
                <div className="p-8 space-y-4">
                    {submissions.filter(sub => String(sub.exam_pin) === String(filterPin)).map(sub => (
                        <div key={sub.id} className={cn("p-6 rounded-[28px] border-2 transition-all flex flex-col gap-4", darkMode ? "bg-white/5 border-white/5" : "bg-neutral-50 border-neutral-100")}>
                            <div className="flex justify-between items-center">
                                <div>
                                    <h5 className="text-sm font-black uppercase">{sub.student_name}</h5>
                                    <p className="text-[10px] font-bold text-neutral-400 mt-1">Enviado: {new Date(sub.created_at).toLocaleTimeString()}</p>
                                </div>
                                <div className="px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl text-[14px] font-black uppercase tracking-widest border border-emerald-500/20">
                                    {sub.score !== undefined && sub.score !== null ? `Calificación: ${sub.score}/100` : 'Entregado'}
                                </div>
                            </div>
                            
                            {/* Desglose de respuestas */}
                            {sub.answers && (
                                <div className="mt-2 p-4 bg-black/5 dark:bg-black/20 rounded-2xl">
                                    <p className="text-[10px] font-bold text-neutral-500 uppercase mb-3">Desglose de Respuestas:</p>
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(sub.answers).map(([qId, ans]) => (
                                            <span key={qId} className="px-3 py-1.5 bg-white dark:bg-[#111] rounded-lg text-[10px] font-black border dark:border-white/10 uppercase">
                                                {typeof ans === 'object' ? ans.text : ans}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {submissions.filter(sub => String(sub.exam_pin) === String(filterPin)).length === 0 && (
                        <div className="flex flex-col items-center justify-center opacity-40 py-10">
                            <span className="text-xs font-black uppercase tracking-widest">Aún no hay entregas</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}


      {/* ── MODAL DE CONFIRMACIÓN CUSTOMIZADO ── */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className={cn(
            "w-full max-w-md p-10 rounded-2xl border shadow-2xl",
            darkMode ? "bg-[#111111] border-red-500/20" : "bg-white border-red-200"
          )}>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-red-500 rounded-2xl flex items-center justify-center shadow-lg shadow-red-500/30 mb-6">
                <Trash2 className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight mb-2">Advertencia</h3>
              <p className="text-sm font-bold text-neutral-500 dark:text-neutral-400 mb-8">
                {confirmModal.message}
              </p>
              
              <div className="flex gap-4 w-full">
                <button 
                  onClick={() => {
                    setConfirmModal({ ...confirmModal, isOpen: false });
                    setDeletingPin(null);
                  }}
                  className="flex-1 py-4 bg-neutral-200 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 rounded-2xl font-black uppercase text-xs tracking-widest hover:opacity-80 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  disabled={isActionLoading}
                  onClick={async () => {
                    setIsActionLoading(true);
                    try {
                      if (confirmModal.isDeleteAllExams) await handleDeleteAllExams();
                      else if (confirmModal.isDeleteExam) await handleDeleteExam(deletingPin);
                      else await executeClearAction();
                    } finally {
                      setIsActionLoading(false);
                      setConfirmModal({ ...confirmModal, isOpen: false });
                    }
                  }}
                  className={cn("flex-1 py-4 text-white rounded-2xl font-black uppercase text-xs tracking-widest transition-all shadow-lg flex items-center justify-center gap-2",
                    isActionLoading ? "bg-red-400 cursor-not-allowed shadow-none" : "bg-red-600 hover:bg-red-700 shadow-red-600/30"
                  )}
                >
                  {isActionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {confirmModal.isDeleteAllExams ? "Sí, Eliminar Todos" : confirmModal.isDeleteExam ? "Sí, Eliminar Examen" : "Sí, Limpiar Historial"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Configuración visual por tipo de anomalía biométrica ─────────────────
function getBioAlertConfig(tipo) {
  const map = {
    rostro_no_detectado: {
      label: 'Rostro no detectado',
      icon: '👁️',
      border: 'border-l-orange-500',
      bg: 'bg-orange-50 dark:bg-orange-950/30',
      text: 'text-orange-600 dark:text-orange-400',
      badgeBg: 'bg-orange-500/10',
      badgeText: 'text-orange-600 dark:text-orange-400',
      badgeBorder: 'border-orange-500/20',
      barColor: 'bg-orange-500',
    },
    suplantacion_identidad: {
      label: 'Suplantación de identidad',
      icon: '🎭',
      border: 'border-l-red-600',
      bg: 'bg-red-50 dark:bg-red-950/40',
      text: 'text-red-600 dark:text-red-400',
      badgeBg: 'bg-red-500/10',
      badgeText: 'text-red-600 dark:text-red-400',
      badgeBorder: 'border-red-500/20',
      barColor: 'bg-red-500',
    },
    multiples_rostros: {
      label: 'Múltiples rostros',
      icon: '👥',
      border: 'border-l-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-950/30',
      text: 'text-purple-600 dark:text-purple-400',
      badgeBg: 'bg-purple-500/10',
      badgeText: 'text-purple-600 dark:text-purple-400',
      badgeBorder: 'border-purple-500/20',
      barColor: 'bg-purple-500',
    },
    dispositivo_movil: {
      label: 'Dispositivo móvil detectado',
      icon: '📱',
      border: 'border-l-yellow-500',
      bg: 'bg-yellow-50 dark:bg-yellow-950/30',
      text: 'text-yellow-700 dark:text-yellow-400',
      badgeBg: 'bg-yellow-500/10',
      badgeText: 'text-yellow-700 dark:text-yellow-400',
      badgeBorder: 'border-yellow-500/20',
      barColor: 'bg-yellow-500',
    },
  };
  return map[tipo] ?? {
    label: tipo?.replace(/_/g, ' ') || 'Anomalía desconocida',
    icon: '⚠️',
    border: 'border-l-neutral-500',
    bg: 'bg-neutral-50 dark:bg-neutral-900/40',
    text: 'text-neutral-600 dark:text-neutral-400',
    badgeBg: 'bg-neutral-500/10',
    badgeText: 'text-neutral-600',
    badgeBorder: 'border-neutral-500/20',
    barColor: 'bg-neutral-500',
  };
}

function KpiCard({ title, value, icon, dark, color, badge }) {
  const colors = {
    red: "from-red-600/20 to-transparent",
    yellow: "from-yellow-600/20 to-transparent",
    blue: "from-blue-600/20 to-transparent",
    purple: "from-purple-600/20 to-transparent"
  };
  return (
    <div className={cn("p-10 rounded-[48px] border shadow-xl relative overflow-hidden transition-all hover:scale-[1.05] hover:shadow-2xl", dark ? "bg-[#111111] border-white/10" : "bg-white border-neutral-100")}>
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-20", colors[color])} />
      <div className="relative z-10 flex items-center justify-between mb-8">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">{title}</span>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black uppercase tracking-widest animate-pulse shadow-md shadow-red-500/30">
              {badge}
            </span>
          )}
          <div className={cn("p-4 rounded-3xl", dark ? "bg-white/5" : "bg-neutral-50 shadow-inner")}>{icon}</div>
        </div>
      </div>
      <div className="relative z-10 text-5xl font-black tracking-tighter">{value}</div>
    </div>
  );
}
