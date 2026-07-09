import React, { useState, useEffect, useRef } from 'react';
import 'regenerator-runtime/runtime';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Mic, ShieldAlert, CheckCircle2, AlertTriangle, LogOut, Loader2, Play, Lock, User, Mail, Hash, Video, AlertOctagon } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CentinelaEngine } from '../lib/monitoring_engine';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useBiometricMonitor } from '../hooks/useBiometricMonitor';
import SalaDiagnostico from './SalaDiagnostico';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StudentPortal({ onExit, darkMode, studentData }) {
  const [step, setStep] = useState('check'); 
  const [formData] = useState({
    matricula: studentData?.matricula || '',
    correo: studentData?.correo || '',
    pin: studentData?.pin || ''
  });
  const [examData, setExamData] = useState(studentData?.exam || null);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [suspicionScore, setSuspicionScore] = useState(0);
  const [lastAlertMessage, setLastAlertMessage] = useState('');
  const [loading, setLoading] = useState(false);
  // EDGE-01: Inicialización con recuperación desde localStorage
  // Si el alumno pierde internet o recarga, recupera sus respuestas automáticamente.
  const [selectedAnswers, setSelectedAnswers] = useState(() => {
    try {
      const pin = studentData?.pin || studentData?.roomCode || '';
      const matricula = studentData?.matricula || '';
      if (!pin || !matricula) return {};
      const saved = localStorage.getItem(`answers_${pin}_${matricula}`);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isWarmingUp, setIsWarmingUp] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [unansweredAlert, setUnansweredAlert] = useState(null); // { idx, label }
  const [showExternalModal, setShowExternalModal] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [isExpelled, setIsExpelled] = useState(false);
  const [diagnosticoAprobado, setDiagnosticoAprobado] = useState(false);
  
  // PASO 3: Referencias solicitadas
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const engineRef = useRef(null);

  // Referencias para evitar stale closures en event listeners
  const matriculaRef = useRef(studentData?.matricula || '');
  const pinRef = useRef(studentData?.pin || studentData?.roomCode || '');
  const stepRef = useRef(step);
  const lastAlertTime = useRef(0);
  const isDeadRef = useRef(false); // Ref sincronizado con isExpelled para stale-closure-safe guards
  const inferenceIntervalRef = useRef(null); // Ref al intervalo del bucle YOLO
  const captureIntervalRef = useRef(null);   // Ref al intervalo de capturas periódicas
  const backendFailCountRef = useRef(0);     // Contador de fallos consecutivos del backend (umbral: 3)

  // ── MÓDULO BIOMÉTRICO: Hook de monitoreo continuo silencioso ───────────────
  // Captura un frame cada 10s y compara con el Rostro Maestro guardado en el login
  const { startMonitoring, stopMonitoring } = useBiometricMonitor();
  const [biometricStatus, setBiometricStatus] = useState(null); // { distancia, esMatch }

  const { transcript, resetTranscript } = useSpeechRecognition();

  // Iniciar la escucha continua al montar el componente
  useEffect(() => {
    SpeechRecognition.startListening({ continuous: true, language: 'es-MX' });
    
    return () => {
      SpeechRecognition.stopListening();
    };
  }, []);

  // Monitorear el texto con Debounce y enviarlo a Supabase
  useEffect(() => {
    // FIREWALL: Apagar si está expulsado
    if (isDeadRef.current || isExpelled) {
      SpeechRecognition.stopListening();
      return;
    }

    const textoActual = transcript.trim();

    // Imprimir en consola para depuración en vivo (puedes ver esto con F12)
    if (textoActual.length > 0) {
      console.log("🗣️ Escuchando:", textoActual);
    }

    // Lógica de Debounce: Esperar 1.5 segundos de silencio antes de empaquetar y enviar
    const timeoutId = setTimeout(() => {
      if (textoActual.length > 3) { // Mínimo 3 caracteres (ej. "hola")
        const mat  = formData?.matricula || studentData?.matricula || "Desconocida";
        const pin  = formData?.pin || studentData?.pin || studentData?.roomCode || "";
        const name = studentData?.nombre_completo || mat || "Estudiante";

        const enviarTranscripcion = async () => {
          try {
            await supabase.from('camera_logs').insert([{
              matricula: mat,
              nombre_completo: name,
              pin_sala: pin,
              event_type: 'TRANSCRIPCION_AUDIO',
              description: textoActual,
              created_at: new Date().toISOString()
            }]);
            resetTranscript(); // Limpiar para la siguiente frase
          } catch (error) {
            console.error("Error al enviar audio:", error);
          }
        };
        enviarTranscripcion();
      }
    }, 1500); // 1500 ms = 1.5 segundos de pausa

    // Limpiar el temporizador si el alumno sigue hablando antes de que se cumpla el tiempo
    return () => clearTimeout(timeoutId);

  }, [transcript, isExpelled, formData, studentData]);


  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    isDeadRef.current = isExpelled;
  }, [isExpelled]);

  useEffect(() => {
    matriculaRef.current = formData?.matricula || studentData?.matricula || '';
    pinRef.current = formData?.pin || studentData?.pin || studentData?.roomCode || '';
  }, [formData, studentData]);

  // EDGE-01: Autosave de respuestas — persiste en localStorage en cada cambio
  // Protege contra cortes de internet, recargas accidentales o cierres del navegador.
  useEffect(() => {
    const pin = formData?.pin || studentData?.pin || studentData?.roomCode || '';
    const matricula = formData?.matricula || studentData?.matricula || '';
    if (!pin || !matricula || Object.keys(selectedAnswers).length === 0) return;
    try {
      localStorage.setItem(`answers_${pin}_${matricula}`, JSON.stringify(selectedAnswers));
    } catch { /* localStorage lleno o bloqueado — ignorar silenciosamente */ }
  }, [selectedAnswers]);

  useEffect(() => {
    if (studentData) {
      initCamera();
      fetchExamData();
    }
  }, [studentData]);

  const fetchExamData = async () => {
    try {
      const currentPin = formData.pin || studentData?.roomCode;
      if (!currentPin) return;

      const { data: dbExam, error } = await supabase
        .from('exams')
        .select('*')
        .eq('pin_sala', currentPin)
        .single();

      if (error) throw error;
      
      if (dbExam) {
        if (dbExam.tipo === 'externo') {
          setExamData({
            titulo: dbExam.title || "Evaluación Digital",
            externalLink: dbExam.url_formulario,
            preguntas: []
          });
        } else if (dbExam.tipo === 'nativo') {
          const { data: preguntasNativas, error: preguntasError } = await supabase
            .from('questions')
            .select(`
              *,
              options (*)
            `)
            .eq('exam_id', dbExam.id);
            
          if (preguntasError) throw preguntasError;
          
          setExamData({
            titulo: dbExam.title || "Evaluación Digital",
            preguntas: (preguntasNativas || []).map(q => ({
              ...q,
              text: q.texto_pregunta,
              options: (q.options || []).map(o => ({
                id: o.id,
                text: o.texto_opcion
              }))
            }))
          });
        } else {
          // Fallback legacy
          let parsedConfig = dbExam.config;
          if (typeof dbExam.config === 'string') {
            try { parsedConfig = JSON.parse(dbExam.config); } catch(e) { console.error(e); }
          }
          if (parsedConfig && parsedConfig.type === 'external_link') {
            setExamData({
              titulo: dbExam.title || "Evaluación Digital",
              externalLink: parsedConfig.url,
              preguntas: []
            });
          } else {
            setExamData({
              titulo: dbExam.title || "Evaluación Digital",
              preguntas: Array.isArray(parsedConfig) ? parsedConfig : []
            });
          }
        }
      }
    } catch (err) {
      console.error("Error al descargar el examen:", err);
    }
  };

  const initCamera = async () => {
    try {
      // ── BUG-02 Fix: Detección de Cámaras Virtuales (Virtual Camera bypass) ─────────
      // Enumeramos los dispositivos para buscar software de transmisión malicioso
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      // Palabras clave comunes de cámaras virtuales y software de inyección
      const virtualKeywords = ['virtual', 'obs', 'manycam', 'droidcam', 'epoccam', 'camo', 'xsplit', 'snap'];

      const hasVirtualCamera = videoDevices.some(device => 
        virtualKeywords.some(keyword => device.label.toLowerCase().includes(keyword))
      );

      if (hasVirtualCamera) {
        const virtualName = videoDevices.find(device => 
            virtualKeywords.some(keyword => device.label.toLowerCase().includes(keyword))
        )?.label || 'Desconocida';

        // Dispara la alerta máxima a la base de datos (CRÍTICO)
        await supabase.from('camera_logs').insert([{
            pin_sala: formData.pin || studentData?.roomCode,
            event_type: 'CRITICO: Cámara Virtual',
            description: `Software detectado: ${virtualName}`,
            matricula: formData.matricula || studentData?.matricula || "Desconocida",
            nombre_completo: formData.matricula || studentData?.matricula || "Estudiante",
            created_at: new Date().toISOString()
        }]);
        
        throw new Error("VIRTUAL_CAMERA_BLOCKED");
      }
      // ─────────────────────────────────────────────────────────────────────────────

      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 }, 
        audio: true 
      });
      streamRef.current = stream;
      setCameraGranted(true);
      setMicGranted(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error media devices.", err);
      if (err.message === "VIRTUAL_CAMERA_BLOCKED") {
          toast.error("VIRTUAL CAM BLOQUEADA: Desactiva OBS, ManyCam o similares para continuar.", { duration: 6000 });
      } else {
          toast.error("Se requiere acceso a la cámara y micrófono (físicos) para realizar el examen.");
      }
    }
  };

  // PASO 4: useEffect para revivir cámara y bucle YOLOv8
  useEffect(() => {
    let videoStream = null;

    const startCameraAndInference = async () => {
      try {
        videoStream = streamRef.current;
        if (videoRef.current && videoStream) {
          videoRef.current.srcObject = videoStream;
        }

        // Bucle de Inferencia (YOLOv8) — PERF-02: 2500ms
        inferenceIntervalRef.current = setInterval(() => {
          // ── GUARD: detener si el alumno ya fue expulsado ──
          if (isDeadRef.current) {
            clearInterval(inferenceIntervalRef.current);
            inferenceIntervalRef.current = null;
            return;
          }
          try {
            if (videoRef.current && canvasRef.current && videoRef.current.readyState === 4 && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
              const context = canvasRef.current.getContext('2d');
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
              context.drawImage(videoRef.current, 0, 0);

              // PERF-02: Calidad 0.5 → ~50% menos de peso por frame
              const frameBase64 = canvasRef.current.toDataURL('image/jpeg', 0.5);

              // EDGE-04: AbortController con timeout de 5s
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);

              const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
              fetch(`${backendUrl}/api/analyze-frame`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image: frameBase64,
                  user_pin: formData.pin || 'ACTUAL_PIN'
                })
              })
              .then(res => res.json())
              .then(async (data) => {
                 // ── GUARD: abortar si fue expulsado mientras el fetch estaba en vuelo ──
                 if (isDeadRef.current) return;

                 const detections = data.detections || [];
                 const highConfPersons = detections.filter(
                   d => (d.class === 'person' || d.class === 'face') && (d.conf ?? d.confidence ?? 0) > 0.75
                 );
                 const faces = highConfPersons.length;
                 const cellPhone = detections.find(d => d.class === 'cell phone');

                 let alertType = null;
                 let confidence = 0;

                 if (cellPhone) {
                    alertType = 'Celular detectado';
                    confidence = cellPhone.conf ?? cellPhone.confidence ?? 0.99;
                 } else if (faces > 1) {
                    alertType = 'Múltiples rostros';
                    const avgConf = highConfPersons.reduce((s, d) => s + (d.conf ?? d.confidence ?? 0), 0) / faces;
                    confidence = avgConf;
                 }

                 if (alertType) {
                    const now = Date.now();
                    if (now - lastAlertTime.current >= 5000) {
                       lastAlertTime.current = now;
                       try {
                           await supabase.from('camera_logs').insert([{
                               pin_sala: formData.pin || studentData?.roomCode,
                               event_type: alertType,
                               description: `Severidad: ${Math.round(confidence * 100)}%`,
                               matricula: formData.matricula || "Desconocida",
                               nombre_completo: formData.matricula || "Estudiante",
                               created_at: new Date().toISOString()
                           }]);
                       } catch (err) {
                           console.error("Alerta fallida:", err);
                       }
                    }
                 }
              })
              .catch((err) => {
                 if (err.name === 'AbortError') return;
                 if (err.message === 'Failed to fetch' || String(err).includes('NetworkError') || String(err).includes('ERR_CONNECTION_REFUSED') || String(err).includes('fetch')) {
                     backendFailCountRef.current += 1;
                     console.warn(`[Centinela] Backend no responde (intento ${backendFailCountRef.current}/3)`);
                     // Solo mostrar error crítico tras 3 fallos consecutivos
                     if (backendFailCountRef.current >= 3) {
                         setServerError(true);
                     }
                 }
              })
              .then(() => {
                 // Reset del contador si el fetch anterior fue exitoso
                 backendFailCountRef.current = 0;
              })
              .finally(() => clearTimeout(timeoutId));
            }
          } catch (e) {
            // Ignorar errores locales de rendering
          }
        }, 2500);

      } catch (err) {
        console.error("Error al acceder a la cámara:", err);
      }
    };

    if (step === 'active') {
      startCameraAndInference();
    }

    return () => {
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
    };
  }, [step]);

  const startExam = async () => {
    setStep('active');
    
    // Forzar pantalla completa
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen API error:", err);
    }
    
    // Pequeño retardo para dar tiempo al DOM de acomodar el video tras fullscreen
    await new Promise(r => setTimeout(r, 500));

    setIsWarmingUp(true);
    await new Promise(r => setTimeout(r, 100));

    engineRef.current = new CentinelaEngine({
      onStatus: (status) => {
        if (status.suspicionScore !== undefined) {
          // ── Bloqueo Anti-Trampa: si hay penalización activa, no dejar que el
          //    enfriamiento de la cámara sobreescriba el score de 100 durante 5s ──
          if (!penaltyLockRef.current) {
            setSuspicionScore(status.suspicionScore);
          }
        }
      },
      onAlert: async (alertData) => {
        // FIREWALL: Bloquear cualquier intento de enviar datos si el alumno fue expulsado
        if (isDeadRef.current || isExpelled) {
          console.log("Firewall bloqueó una alerta fantasma.");
          return; 
        }

        setAlerts(prev => [alertData, ...prev].slice(0, 5));
        setLastAlertMessage(alertData.message || alertData.type || '');

        // A-3 Fix: try-catch para evitar unhandled rejection si Supabase falla
        try {
          await supabase.from('camera_logs').insert([{
            event_type: alertData.type,
            description: alertData.message,
            nombre_completo: formData.matricula,
            matricula: formData.matricula,
            correo: formData.correo,
            pin_sala: formData.pin.toUpperCase(),
            created_at: new Date().toISOString()
          }]);

          if (alertData.type === 'OBJETO_PROHIBIDO') {
            captureAndUpload();
          }
        } catch (error) {
          console.error("Falla en sincronización de alerta:", error);
        }
      }
    });

    await engineRef.current.init(streamRef.current);
    setTimeout(async () => {
        if (videoRef.current) {
            engineRef.current.start(videoRef.current);
        }
        setIsWarmingUp(false);

        // ── INICIAR MONITOREO BIOMÉTRICO SILENCIOSO ──────────────────────
        // Se ejecuta en segundo plano cada 10 segundos (setTimeout recursivo).
        // Compara el rostro actual con el Rostro Maestro guardado en el login.
        // Los eventos se registran en `telemetria_examenes` (Supabase).
        //
        // BIO-FIX-2: await garantiza que el bucle arranca DESPUÉS de que
        // ensureHumanReady() termine. Evita condición de carrera en Celeron.
        //
        // Firma v3: startMonitoring(videoElement, estudianteId, onStatusUpdate)
        //   estudianteId → matrícula plana (string), clave en telemetria_examenes
        await startMonitoring(
          videoRef.current,
          formData.matricula || studentData?.matricula || 'Desconocida',
          (status) => {
            // status = { tipoAnomalia, nivelConfianza, esMatch, timestamp }
            setBiometricStatus(status);
            if (!status.esMatch && status.tipoAnomalia) {
              const mensajes = {
                rostro_no_detectado:    'Monitor biométrico: sin rostro en cámara',
                suplantacion_identidad: 'Monitor biométrico: posible suplantación de identidad',
                multiples_rostros:      'Monitor biométrico: múltiples personas detectadas',
                dispositivo_movil:      'Monitor biométrico: dispositivo móvil detectado',
              };
              setLastAlertMessage(mensajes[status.tipoAnomalia] ?? 'Alerta biométrica');
            }
          }
        );
        // ────────────────────────────────────────────────────────
    }, 800);
  };

  useEffect(() => {
    if (step === 'active') {
        captureIntervalRef.current = setInterval(captureAndUpload, 30000);
    }
    return () => {
        if (captureIntervalRef.current) {
          clearInterval(captureIntervalRef.current);
          captureIntervalRef.current = null;
        }
    };
  }, [step]);

  // EVENTOS DE INTEGRIDAD (visibilitychange y fullscreenchange) han sido movidos a main.jsx (Global Listener)
  // para evitar problemas con el ciclo de vida de React y los montajes/desmontajes.

  const captureAndUpload = async () => {
    // A-5 Fix: verificar que el stream tiene dimensiones válidas antes de capturar
    if (!videoRef.current || !videoRef.current.videoWidth || !videoRef.current.videoHeight) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
        if (blob) {
            const fileName = `${formData.matricula}.jpg`;
            await supabase.storage.from('snapshots').upload(fileName, blob, {
                upsert: true
            });
        }
    } catch (e) {
        console.warn("Error uploading snapshot:", e);
    }
  };

  // ── FRENO DE ENTREGA INTELIGENTE ─────────────────────────────────────
  const handleDeliverGuard = () => {
    // Caso A: Formulario externo → Modal de Confirmación Estricto
    if (examData?.externalLink) {
      setExternalConfirmed(false);
      setShowExternalModal(true);
      return;
    }

    // Caso B: Exámen nativo → validar preguntas sin contestar
    if (examData?.preguntas?.length > 0) {
      const unansweredIdx = examData.preguntas.findIndex((_, idx) => {
        const ans = selectedAnswers[idx];
        return ans === undefined || ans === null || String(ans).trim() === '';
      });
      if (unansweredIdx !== -1) {
        const q = examData.preguntas[unansweredIdx];
        const label = q?.text
          ? `"${q.text.substring(0, 60)}${q.text.length > 60 ? '...' : ''}"`
          : `Número ${unansweredIdx + 1}`;
        setUnansweredAlert({ idx: unansweredIdx + 1, label });
        
        toast.error('Faltan preguntas por responder');
        
        // Scroll automático a la pregunta sin contestar
        const el = document.getElementById(`question-${unansweredIdx}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Resaltado visual temporal
          el.classList.add('ring-4', 'ring-red-500', 'rounded-2xl', 'transition-all', 'duration-500');
          setTimeout(() => el.classList.remove('ring-4', 'ring-red-500', 'rounded-2xl'), 3000);
        }
        return;
      }
    }

    // Todo OK → enviar
    setUnansweredAlert(null);
    handleSubmitExam();
  };
  // ─────────────────────────────────────────────────────────────────

  const handleSubmitExam = async () => {
    try {
      setLoading(true);
      
      const resolvedPin = formData.pin || studentData?.pin || studentData?.roomCode || '';
      
      // ── BUG-01 Fix: Calificación segura en el servidor ──────────────────────
      // El cliente ya NO tiene acceso a correctOption (fue eliminado del JSON público).
      // Llamamos al backend Flask que lee exam_answers (protegida con RLS) y calcula
      // el puntaje — el cliente recibe únicamente el número final, nunca las respuestas.
      let calculatedScore = null;
      try {
        const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const gradeRes = await fetch(`${backendUrl}/api/grade`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin: resolvedPin,
            answers: selectedAnswers  // {"0": "a", "1": "c", ...}
          })
        });
        clearTimeout(timeoutId);

        if (gradeRes.ok) {
          const gradeData = await gradeRes.json();
          // gradeData = { score: 85, correctas: 7, total: 8 }
          calculatedScore = gradeData.score ?? null;
        }
      } catch (gradeErr) {
        // Backend no disponible — score queda null (no enviar dato incorrecto)
        console.warn('[Centinela] No se pudo calificar en el servidor:', gradeErr);
      }

      const submission = {
        exam_pin: String(resolvedPin),
        student_name: String(formData.matricula || studentData?.matricula || "Desconocido"),
        answers: selectedAnswers,
        score: calculatedScore  // null si el backend no respondió
      };
      
      const { error } = await supabase.from('exam_submissions').insert([submission]);
      if (error) throw error;

      // Limpiar autosave del localStorage al entregar exitosamente
      try {
        const pin = resolvedPin;
        const matricula = formData.matricula || studentData?.matricula || '';
        if (pin && matricula) {
          localStorage.removeItem(`answers_${pin}_${matricula}`);
        }
      } catch { /* ignorar */ }

      setIsSubmitted(true);
    } catch (err) {
      console.error("Error al enviar examen:", err);
      toast.error("Hubo un error al enviar tu examen. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const exitPortal = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (engineRef.current) engineRef.current.stop();
    // ── BIO-FIX-1: detener el bucle biométrico al salir voluntariamente ──
    stopMonitoring();
    localStorage.removeItem('centinela_session');
    onExit();
  };

  const setVideoRef = React.useCallback((node) => {
    if (node) {
      videoRef.current = node;
      if (streamRef.current) {
        node.srcObject = streamRef.current;
        node.play().catch(e => console.warn("Video play auto-recovery", e));
      }
    }
  }, [step]);

  useEffect(() => {
    if (step === 'active' && formData.matricula) {
      // Fuente única de verdad: Postgres Changes sobre la tabla commands
      // (REPLICA IDENTITY FULL habilitado + tabla en supabase_realtime)
      const channel = supabase
        .channel(`commands-${formData.matricula}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'commands',
            filter: `matricula=eq.${formData.matricula}`
          },
          (payload) => {
            const cmd = payload.new;
            if (cmd.command === 'ALERTA') {
              const msg = cmd.payload?.message || "Llamada de atención del docente.";
              setAlerts(prev => [{ type: 'SISTEMA', message: msg }, ...prev].slice(0, 5));
              toast(`MENSAJE DEL DOCENTE: ${msg}`, { icon: '⚠️' });
            } else if (cmd.command === 'EXPULSAR') {
              // 1. Activar el Kill Switch inmutable
              isDeadRef.current = true;
              
              // 2. Apagar cámara físicamente
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
              }

              // 3. A-2 Fix: limpiar únicamente los recursos propios del proyecto
              clearInterval(inferenceIntervalRef.current);
              inferenceIntervalRef.current = null;
              clearInterval(captureIntervalRef.current);
              captureIntervalRef.current = null;
              cancelAnimationFrame(engineRef.current?.animationFrameId);
              if (engineRef.current) engineRef.current.stop();
              // ── BIO-FIX-3: matar el bucle silencioso de 10s al expulsar ──
              stopMonitoring();

              // 4. Mostrar pantalla roja
              setIsExpelled(true);
            }
          }
        )
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [step, formData.matricula]);


  // ── ANTI-TRAMPA: Control de Pestañas, Foco y Pantalla Completa ───────────────
  // penaltyLockRef: ref booleano que bloquea el enfriamiento del score durante 5s
  const penaltyLockRef = useRef(false);
  const penaltyTimerRef = useRef(null);

  // Helper: activa el bloqueo de 5s, dispara score al máximo, registra en Supabase
  const triggerAntiCheatPenalty = React.useCallback(async (reason, eventType = 'CRITICO') => {
    // ── GUARD: si el alumno ya fue expulsado, no generar más alertas fantasma ──
    if (isDeadRef.current) return;

    // 1. Bloqueo temporal: evita que el ciclo de cámara baje el score durante 5s
    penaltyLockRef.current = true;
    if (penaltyTimerRef.current) clearTimeout(penaltyTimerRef.current);
    penaltyTimerRef.current = setTimeout(() => {
      penaltyLockRef.current = false;
    }, 5000);

    // 2. Disparar score y mensaje de alerta al máximo
    setSuspicionScore(100);
    setLastAlertMessage(reason);

    // 3. Registrar como evento en Supabase (visible en rojo en el dashboard del profesor)
    try {
      await supabase.from('camera_logs').insert([{
        pin_sala: pinRef.current || '',
        event_type: eventType,
        description: reason,
        matricula: matriculaRef.current || "Desconocida",
        nombre_completo: matriculaRef.current || "Estudiante",
        created_at: new Date().toISOString()
      }]);
    } catch (e) {
      console.error("Anti-trampa: no se pudo registrar en Supabase:", e);
    }
  }, []); // sin deps: usa refs estables para acceder a pin/matricula y isDeadRef

  useEffect(() => {
    if (step !== 'active') return;

    // Detecta si el usuario cambia de pestaña o minimiza el navegador
    const handleVisibilityChange = () => {
      if (isDeadRef.current) return; // Guard: no disparar si ya fue expulsado
      if (document.hidden) {
        triggerAntiCheatPenalty("El alumno abandonó la pestaña del examen", "CAMBIO_DE_PESTAÑA");
      }
    };

    // Detecta si el usuario hace clic fuera de la ventana del navegador
    const handleWindowBlur = () => {
      if (isDeadRef.current) return; // Guard: no disparar si ya fue expulsado
      triggerAntiCheatPenalty("El alumno perdió el foco de la ventana", "CAMBIO_DE_PESTAÑA");
    };

    // Detecta si el usuario presiona Escape y sale de la pantalla completa
    const handleFullscreenChange = () => {
      if (isDeadRef.current) return; // Guard: no disparar si ya fue expulsado
      if (!document.fullscreenElement) {
        triggerAntiCheatPenalty("El alumno presionó Escape y salió de pantalla completa", "SALIDA_PANTALLA_COMPLETA");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    // Limpieza de los listeners y del timer al desmontar
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (penaltyTimerRef.current) clearTimeout(penaltyTimerRef.current);
    };
  }, [step, triggerAntiCheatPenalty]);
  // ─────────────────────────────────────────────────────────────────────

  const formatEmbedUrl = (url) => {
    if (url && url.includes('docs.google.com/forms')) {
      return url.includes('?')
        ? url.replace('/viewform', '/viewform').replace(/([?&])embedded=[^&]*/, '') + '&embedded=true'
        : url.replace('/viewform', '/viewform?embedded=true');
    }
    return url;
  };
  const embedUrl = examData?.externalLink ? formatEmbedUrl(examData.externalLink) : null;

  // SI EL DIAGNÓSTICO NO ESTÁ APROBADO, RENDERIZAR LA SALA DE DIAGNÓSTICO
  if (!diagnosticoAprobado) {
    return <SalaDiagnostico onDiagnosticoCompletado={() => setDiagnosticoAprobado(true)} />;
  }

  // SI EL ALUMNO ESTÁ EXPULSADO, RENDERIZAR SOLO ESTO Y DESTRUIR EL EXAMEN
  if (isExpelled) {
    return (
      <div className="min-h-screen bg-red-900 flex flex-col items-center justify-center p-4 fixed inset-0 z-[9999]">
        <div className="bg-white p-10 rounded-3xl shadow-2xl max-w-xl w-full text-center transform transition-all scale-100">
          <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-4">EXAMEN CANCELADO</h1>
          <p className="text-gray-800 text-lg font-medium mb-2">
            El profesor ha suspendido tu evaluación por actividad irregular.
          </p>
          <p className="text-gray-500 text-sm mb-10">
            SI CREES QUE ESTO ES UN ERROR, CONTACTA A TU DOCENTE.
          </p>
          <button
            onClick={() => { 
              // 1. Destruir absolutamente toda la memoria de la sesión del alumno
              localStorage.clear();
              sessionStorage.clear();
              
              // 2. Apagar la cámara de forma forzada por si quedó algún track colgado
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
              }

              // 3. Redirección con reemplazo de historial (evita que el alumno use el botón 'Atrás' del navegador)
              // NOTA PARA ANTIGRAVITY: Asegúrate de que '/' sea la ruta absoluta donde se renderizan los botones 'Portal Docente' y 'Portal Alumno'. Si es otra ruta (ej. '/home'), cámbiala aquí.
              window.location.replace('/'); 
            }}
            className="w-full py-4 bg-gray-900 hover:bg-black text-white text-lg font-bold rounded-xl transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            VOLVER AL MENÚ PRINCIPAL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen font-sans transition-colors duration-300", darkMode ? "bg-surf-dark text-neutral-100" : "bg-[#f8f9fa] text-neutral-900")}>
      {serverError && (
        <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
            <AlertOctagon className="w-32 h-32 text-red-500 mb-8 animate-pulse drop-shadow-[0_0_30px_rgba(239,68,68,0.5)]" />
            <h1 className="text-4xl md:text-5xl font-black text-white uppercase tracking-tighter mb-6">Error de Conexión</h1>
            <p className="text-lg md:text-xl text-red-200 max-w-2xl font-bold bg-red-950/50 p-8 rounded-[32px] border-2 border-red-500/30 shadow-2xl leading-relaxed">
                El servidor local de inferencia de IA parece estar detenido. Detén tu terminal (Ctrl + C) y vuelve a ejecutar: <br/><br/>
                <code className="text-white bg-black px-6 py-3 rounded-2xl text-2xl tracking-widest border border-red-500/50 shadow-inner block mx-auto w-fit">npm run dev</code>
            </p>
            <button onClick={() => window.location.reload()} className="mt-12 px-12 py-5 bg-white text-black font-black uppercase text-sm rounded-[24px] hover:scale-105 transition-all shadow-xl">
                Recargar Sistema
            </button>
        </div>
      )}
      <nav className={cn("flex items-center justify-between px-8 py-5 border-b sticky top-0 z-50", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="font-black text-sm uppercase tracking-tighter block text-white">Centinela IA</span>
            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Portal Estudiantil</span>
          </div>
        </div>
        
        <button onClick={exitPortal} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-red-500 hover:bg-red-500/10 transition-all">
          <LogOut className="w-4 h-4" /> SALIR
        </button>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {step === 'check' && (
            <motion.div key="check" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={cn("p-12 rounded-[48px] border", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200 shadow-2xl")}>
              <h2 className="text-2xl font-black mb-10 text-center uppercase tracking-tight">Verificación de Hardware</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="relative group">
                  <div className="w-full aspect-video bg-black rounded-[32px] overflow-hidden relative border-4 border-neutral-200 dark:border-neutral-800 shadow-2xl">
                    <video ref={setVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                    {!cameraGranted && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
                            <Loader2 className="w-8 h-8 text-white animate-spin mb-4" />
                            <span className="text-xs font-black text-white uppercase tracking-widest text-center px-6">Solicitando Acceso...</span>
                        </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-6">
                    <CheckItem active={cameraGranted} label="Cámara Web" icon={<Camera className="w-5 h-5" />} />
                    <CheckItem active={micGranted} label="Micrófono" icon={<Mic className="w-5 h-5" />} />
                    <div className="p-8 rounded-[32px] border-2 border-blue-500/10 bg-blue-500/5">
                        <div className="flex items-center gap-3 mb-3">
                            <Video className="w-5 h-5 text-blue-600" />
                            <span className="text-xs font-black uppercase text-blue-600">Aviso de Privacidad</span>
                        </div>
                        <p className="text-[11px] font-bold text-neutral-500 leading-relaxed italic">
                          "El sistema detectará automáticamente objetos no permitidos y movimientos sospechosos. Tu privacidad está protegida."
                        </p>
                    </div>
                </div>
              </div>
              <div className="mt-16 flex flex-col items-center gap-4">
                <button 
                  onClick={startExam} 
                  disabled={!cameraGranted} 
                  className="px-16 py-6 bg-black dark:bg-white dark:text-black text-white rounded-[28px] text-base font-black hover:scale-[1.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-2xl uppercase tracking-widest"
                >
                  <Play className="inline mr-3 w-5 h-5 fill-current" /> Iniciar Monitoreo
                </button>
              </div>
            </motion.div>
          )}

          {step === 'active' && (
            <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col lg:flex-row gap-8 min-h-[85vh]">
              {isSubmitted ? (
                <div className="w-full flex items-center justify-center min-h-[60vh]">
                  <div className={cn("max-w-xl w-full p-16 rounded-[48px] border shadow-2xl text-center", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                    <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl shadow-emerald-500/20">
                      <CheckCircle2 className="w-12 h-12 text-white" />
                    </div>
                    <h2 className="text-3xl font-black uppercase tracking-tight mb-4">¡Felicidades!</h2>
                    <p className="text-neutral-500 font-medium mb-12">Examen completado y enviado con éxito. Ya puedes cerrar el sistema.</p>
                    <button 
                      onClick={exitPortal} 
                      className="px-12 py-5 bg-black dark:bg-white dark:text-black text-white rounded-[24px] font-black uppercase text-sm tracking-widest hover:scale-105 transition-transform shadow-2xl"
                    >
                      Salir de forma segura
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* LADO IZQUIERDO: MONITOREO IA */}
                  <div className="w-full lg:w-[400px] space-y-6 shrink-0">
                <div className={cn("p-8 rounded-[40px] border shadow-2xl sticky top-28", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                  
                  {/* PASO 5: Contenedor CENTINELA LIVE inyectado estrictamente */}
                  <div className={`relative w-full h-64 bg-black rounded-xl overflow-hidden border-4 transition-all duration-500 ${
                    suspicionScore < 20
                      ? 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]'
                      : suspicionScore < 85
                        ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]'
                        : 'border-red-600 shadow-[0_0_20px_rgba(220,38,38,0.8)] animate-pulse'
                  }`}>
                    <video 
                      ref={setVideoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
                      🔴 CENTINELA LIVE
                    </div>
                    {isWarmingUp && (
                      <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                        <span className="text-white text-[10px] font-black uppercase text-center px-4 leading-tight">
                          Inicializando motor de<br />Inteligencia Artificial local...
                        </span>
                      </div>
                    )}

                    {/* Badge de estado flotante según nivel de sospecha */}
                    {suspicionScore >= 20 && (
                      <div className={`absolute top-2 right-2 px-3 py-1 rounded text-white font-bold text-xs shadow-md animate-pulse ${
                        suspicionScore < 85 ? 'bg-yellow-500' : 'bg-red-600'
                      }`}>
                        {suspicionScore < 85
                          ? 'PRECAUCIÓN'
                          : `ALERTA: ${lastAlertMessage || 'Comportamiento indebido'}`}
                      </div>
                    )}
                  </div>


                  
                  <div className="pt-8 border-t border-neutral-100 dark:border-white/5">
                      <div className="flex items-center justify-between mb-6">
                        <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Alertas de IA</span>
                        <span className="text-[10px] font-black text-emerald-500 uppercase flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                            Activo
                        </span>
                      </div>
                      <div className="space-y-4">
                          {alerts.length === 0 ? (
                              <div className="flex items-center gap-3 p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-600">
                                <CheckCircle2 className="w-5 h-5" />
                                <span className="text-[10px] font-black uppercase">Sin Incidentes</span>
                              </div>
                          ) : (
                              alerts.map((a, i) => (
                                <motion.div key={i} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-start gap-4 p-4 rounded-2xl bg-red-500/5 border border-red-500/10">
                                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-black text-red-600 uppercase">{a.type}</span>
                                            {a.type === 'RUIDO_DETECTADO' && <Mic className="w-3 h-3 text-red-500 animate-pulse" />}
                                        </div>
                                        <p className="text-[10px] text-neutral-500 leading-tight font-medium">{a.message}</p>
                                    </div>
                                </motion.div>
                              ))
                          )}
                      </div>
                  </div>
                </div>
              </div>

              {/* LADO DERECHO: EXAMEN */}
              <div className={cn("flex-1 rounded-[40px] border overflow-hidden flex flex-col shadow-2xl relative", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
                
                {/* BARRA DE PROGRESO MINIMALISTA SUPERIOR */}
                <div className="absolute top-0 left-0 w-full h-1.5 bg-black/20 z-10">
                  {examData?.externalLink ? (
                    <div className="h-full bg-emerald-400 w-full animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
                  ) : (
                    <div 
                      className="h-full bg-emerald-400 transition-all duration-500 shadow-[0_0_10px_rgba(52,211,153,0.5)]" 
                      style={{ 
                        width: `${examData?.preguntas?.length ? Math.round((Object.keys(selectedAnswers).filter(k => {
                          const v = selectedAnswers[k];
                          return v !== undefined && v !== null && String(v).trim() !== '';
                        }).length / examData.preguntas.length) * 100) : 0}%` 
                      }} 
                    />
                  )}
                </div>

                <div className="px-12 py-10 pt-12 border-b border-neutral-100 dark:border-white/5 flex items-center justify-between bg-blue-600">
                    <div>
                        {examData?.externalLink ? (
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                <span className="text-[10px] font-black text-emerald-100 uppercase tracking-[0.2em]">Examen en progreso</span>
                            </div>
                        ) : (
                            <span className="text-[10px] font-black text-blue-100 uppercase tracking-[0.2em] mb-2 block">Evaluación Digital</span>
                        )}
                        <h3 className="text-2xl font-black text-white uppercase tracking-tight">{examData?.titulo}</h3>
                    </div>
                    <div className="text-right">
                        <span className="text-[10px] font-black text-blue-100 uppercase block mb-1">Matrícula</span>
                        <span className="text-sm font-bold text-white">{formData.matricula}</span>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-12 space-y-12">
                    {examData?.externalLink ? (
                      <div className="flex flex-col gap-4 h-full">
                        <button
                          onClick={() => window.open(examData.externalLink, 'ExamenExterno', 'width=800,height=800,popup=true,scrollbars=yes')}
                          className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 text-xs font-black hover:bg-yellow-500/20 transition-all w-full justify-center"
                        >
                          <span>⚠️</span>
                          ¿El formulario aparece en blanco? Ábrelo en una ventana segura
                        </button>
                        <iframe
                          src={embedUrl}
                          width="100%"
                          height="100%"
                          className="min-h-[70vh] rounded-xl border-0 flex-1"
                          title="Formulario Externo"
                          allow="fullscreen"
                        />
                      </div>
                    ) : examData?.preguntas && examData.preguntas.length > 0 ? (
                        examData.preguntas.map((q, idx) => (
                            <div key={idx} id={`question-${idx}`} className="space-y-6">
                                <div className="flex gap-6">
                                    <span className="w-10 h-10 bg-neutral-100 dark:bg-white/5 rounded-2xl flex items-center justify-center text-xs font-black shrink-0">{idx + 1}</span>
                                    <h4 className="text-lg font-bold leading-relaxed">{q.text}</h4>
                                </div>
                                {q.options && q.options.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-16">
                                        {q.options.map(opt => (
                                            <button 
                                                key={opt.id} 
                                                onClick={() => setSelectedAnswers(prev => ({ ...prev, [idx]: opt.id }))}
                                                className={cn("text-left p-5 rounded-[20px] border-2 transition-all flex items-center gap-4 group",
                                                    selectedAnswers[idx] === opt.id 
                                                        ? "border-blue-600 bg-blue-600/5" 
                                                        : "border-neutral-100 dark:border-white/5 hover:border-blue-600 hover:bg-blue-600/5")}
                                            >
                                                <div className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                                                    selectedAnswers[idx] === opt.id 
                                                        ? "border-blue-600 bg-blue-600 text-white" 
                                                        : "border-neutral-300 dark:border-neutral-700 group-hover:border-blue-600 text-neutral-400 group-hover:text-blue-600")}>
                                                    <span className={cn("text-[10px] font-black uppercase", selectedAnswers[idx] === opt.id ? "text-white" : "text-neutral-400 group-hover:text-blue-600")}>{opt.id}</span>
                                                </div>
                                                <span className="text-sm font-bold">{opt.text}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="ml-16">
                                        <textarea 
                                            placeholder="Escribe tu respuesta aquí..."
                                            value={selectedAnswers[idx] || ''}
                                            onChange={(e) => setSelectedAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                                            className="w-full p-6 rounded-[24px] border-2 border-neutral-100 dark:border-white/5 bg-transparent focus:border-blue-600 focus:outline-none transition-all font-medium"
                                            rows={4}
                                        />
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
                            <h4 className="text-lg font-black uppercase mb-2">Examen Completado o Sin Preguntas</h4>
                            <p className="text-xs text-neutral-500 uppercase tracking-widest">Espera instrucciones de tu docente.</p>
                        </div>
                    )}
                </div>

                <div className="p-8 border-t dark:border-white/5 bg-neutral-50 dark:bg-white/2 flex flex-col gap-4">
                    {/* Alerta roja de preguntas sin contestar */}
                    {unansweredAlert && (
                      <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-600/10 border-2 border-red-500/40 animate-in slide-in-from-bottom-2 duration-300">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-black text-red-600 uppercase tracking-wide">No puedes entregar</p>
                          <p className="text-[11px] text-red-500 font-bold mt-0.5">
                            Te falta contestar la pregunta {unansweredAlert.idx}: {unansweredAlert.label}
                          </p>
                        </div>
                        <button onClick={() => setUnansweredAlert(null)} className="ml-auto text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-4">
                      {/* Contador de progreso */}
                      {examData?.preguntas?.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
                            {Object.keys(selectedAnswers).filter(k => {
                              const v = selectedAnswers[k];
                              return v !== undefined && v !== null && String(v).trim() !== '';
                            }).length}
                            /{examData.preguntas.length} respondidas
                          </span>
                          <div className="w-24 h-1.5 bg-neutral-200 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-500"
                              style={{
                                width: `${
                                  Math.round(
                                    (Object.keys(selectedAnswers).filter(k => {
                                      const v = selectedAnswers[k];
                                      return v !== undefined && v !== null && String(v).trim() !== '';
                                    }).length / examData.preguntas.length) * 100
                                  )
                                }%`
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <button 
                          onClick={handleDeliverGuard} 
                          disabled={loading}
                          className="px-10 py-4 bg-emerald-600 text-white rounded-[20px] font-black uppercase text-xs tracking-widest hover:scale-105 transition-all shadow-xl shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                      >
                          {loading ? 'Enviando...' : 'Terminar Examen'}
                      </button>
                    </div>
                </div>
               </div>
               </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── MODAL DE CONFIRMACIÓN PARA FORMULARIOS EXTERNOS ── */}
      {showExternalModal && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className={cn(
            "w-full max-w-lg p-10 rounded-[40px] border-2 shadow-2xl",
            darkMode ? "bg-[#111111] border-yellow-500/40" : "bg-white border-yellow-400"
          )}>
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-yellow-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-yellow-500/30">
                <AlertTriangle className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight">Atención</h3>
                <p className="text-[11px] text-yellow-600 font-black uppercase tracking-widest">Formulario Externo Detectado</p>
              </div>
            </div>

            {/* Cuerpo del aviso */}
            <p className="text-sm font-bold text-neutral-600 dark:text-neutral-300 leading-relaxed mb-6">
              Estás usando un formulario externo (Google Forms, MS Forms, PDF, etc.).
              Como el sistema no puede verificar si ya enviaste tu respuesta dentro del formulario,
              necesitas confirmar manualmente que ya presionaste el botón de{' '}
              <span className="text-yellow-600 font-black uppercase">ENVIAR</span> dentro del formulario
              <span className="font-black"> antes</span> de cerrar esta ventana.
            </p>

            {/* Checkbox obligatorio */}
            <label className={cn(
              "flex items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all mb-8",
              externalConfirmed
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-neutral-200 dark:border-white/10 hover:border-yellow-400"
            )}>
              <input
                type="checkbox"
                checked={externalConfirmed}
                onChange={e => setExternalConfirmed(e.target.checked)}
                className="w-5 h-5 mt-0.5 accent-emerald-500 shrink-0 cursor-pointer"
              />
              <span className="text-sm font-black uppercase tracking-tight">
                Confirmo que ya envié mi examen dentro del formulario externo
              </span>
            </label>

            {/* Botones */}
            <div className="flex gap-4">
              <button
                onClick={() => { setShowExternalModal(false); setExternalConfirmed(false); }}
                className="flex-1 py-4 rounded-[20px] border-2 border-neutral-200 dark:border-white/10 text-xs font-black uppercase tracking-widest hover:bg-neutral-100 dark:hover:bg-white/5 transition-all"
              >
                Volver al Examen
              </button>
              <button
                onClick={async () => {
                  setShowExternalModal(false);
                  // Registrar entrega en Supabase y luego apagar cámara
                  await handleSubmitExam();
                  // exitPortal() se llama desde la pantalla de éxito →
                  // la pantalla isSubmitted ya tiene el botón "Salir de forma segura"
                  // Pero también forzamos salida automática tras 2s para formularios externos
                  setTimeout(() => exitPortal(), 2000);
                }}
                disabled={!externalConfirmed || loading}
                className="flex-1 py-4 bg-emerald-600 text-white rounded-[20px] text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100"
              >
                {loading ? 'Finalizando...' : '✅ Finalizar y Apagar Cámara'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckItem({ active, label, icon }) {
    return (
        <div className={cn("p-8 rounded-[32px] border-2 transition-all flex items-center justify-between", active ? "bg-emerald-500/10 border-emerald-500/20" : "bg-neutral-50 dark:bg-white/5 border-neutral-100 dark:border-white/5")}>
            <div className="flex items-center gap-5">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm", active ? "bg-emerald-500 text-white" : "bg-neutral-200 dark:bg-white/10 text-neutral-400")}>
                    {icon}
                </div>
                <span className="text-sm font-black uppercase tracking-tight">{label}</span>
            </div>
            {active && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
        </div>
    );
}
