import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, CheckCircle2, ArrowRight, FileText, Check, Trash2, ChevronLeft, Wand2, Type, ListChecks, Layout, Link as LinkIcon, FileCode2 } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuración del worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function MagicExamCreator({ onComplete, darkMode }) {
  const [step, setStep] = useState(0);
  const [examTitle, setExamTitle] = useState('Nuevo Examen Centinela');
  const [pin, setPin] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef(null);
  const [questions, setQuestions] = useState([]);
  const [importMode, setImportMode] = useState(null); 
  const [externalLink, setExternalLink] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (questions.length > 0) {
      localStorage.setItem('draft_exam', JSON.stringify({ title: examTitle, questions }));
    }
  }, [questions, examTitle]);

  // --- NUEVO MOTOR DE PROCESAMIENTO DINÁMICO CON IA (PIPELINE DE 2 FASES) ---
  const handleUpload = async (file) => {
    setStep(2);
    setOcrProgress(0);
    setErrorMessage('');
    setOcrStatus('Extrayendo texto del documento...');

    try {
      let fullText = "";

      // 1. Extracción de texto crudo
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          setOcrStatus(`Leyendo página ${i}...`);
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => item.str).join(' ') + "\n";
          setOcrProgress(Math.floor((i / pdf.numPages) * 40));
        }
      } else {
        const worker = await createWorker('spa', 1);
        setOcrStatus("Ejecutando OCR...");
        const { data: { text } } = await worker.recognize(file);
        fullText = text;
        await worker.terminate();
      }

      console.log("🔍 [DEBUG 0] TEXTO CRUDO DEL OCR:\n", fullText);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

      if (apiKey && apiKey.length > 10) {
        try {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

          // =========================================================
          // FASE 1: PURIFICACIÓN Y CORRECCIÓN ORTOGRÁFICA (Solo texto)
          // =========================================================
          setOcrProgress(50);
          setOcrStatus("Fase 1: IA limpiando basura y corrigiendo OCR...");

          const systemPrompt1 = `Eres un purificador de texto de exámenes.
                  Tus únicas 3 tareas son:
                  1. Detectar dónde empieza la pregunta número 1 (o la primera pregunta evaluativa).
                  2. ELIMINAR ABSOLUTAMENTE TODO el texto que esté antes de esa pregunta (nombres de instituciones, introducciones, instrucciones generales, fechas).
                  3. Corregir errores ortográficos generados por el escaneo OCR.
                  NO devuelvas un JSON. Devuelve únicamente el texto limpio de las preguntas.`;
          
          const userPrompt1 = `Purifica este texto escaneado:\n\n${fullText}`;

          const result1 = await model.generateContent({
             contents: [{ role: 'user', parts: [{ text: systemPrompt1 + "\n\n" + userPrompt1 }] }],
             generationConfig: { temperature: 0.1 }
          });
          const cleanText = result1.response.text();
          
          console.log("🧼 [DEBUG 1] TEXTO PURIFICADO POR LA IA:\n", cleanText);

          // =========================================================
          // FASE 2: ESTRUCTURACIÓN ESTRICTA (Generación de JSON)
          // =========================================================
          setOcrProgress(75);
          setOcrStatus("Fase 2: IA estructurando datos en JSON...");

          const systemPrompt2 = `Eres un formateador de datos. Convierte el texto proporcionado en un objeto JSON estricto sin usar formato markdown.
                  ESTRUCTURA OBLIGATORIA:
                  {"preguntas": [ {"tipo": "multiple", "pregunta": "1. ¿Qué es...?", "opciones": ["a) ...", "b) ..."], "correcta": "a"} ]}
                  Si la pregunta no tiene opciones (incisos a, b, c), asígnale "tipo": "open" y "opciones": [].`;

          const userPrompt2 = `Convierte este texto limpio en JSON puramente (sin markdown):\n\n${cleanText}`;

          const result2 = await model.generateContent({
             contents: [{ role: 'user', parts: [{ text: systemPrompt2 + "\n\n" + userPrompt2 }] }],
             generationConfig: { 
                 temperature: 0.1
             }
          });
          const rawJsonText = result2.response.text();
          console.log("🧠 [DEBUG 2] JSON FINAL:\n", rawJsonText);
          
          const parsedData = JSON.parse(rawJsonText);
          const rawArray = parsedData.preguntas || [];
          
          // 3. Mapeo al Estado de React
          const structuredQuestions = rawArray.map((item, index) => {
            const isMultiple = item.tipo === 'multiple';
            return {
              id: crypto.randomUUID ? crypto.randomUUID() : `q-${Date.now()}-${index}`,
              type: isMultiple ? 'multiple' : 'open',
              text: item.pregunta || '',
              options: isMultiple ? (item.opciones || []).map((txt, i) => ({ id: ['a','b','c','d','e'][i] || String(i), text: txt })) : [],
              correctOption: isMultiple ? (item.correcta || 'a').toLowerCase() : null
            };
          });
          
          setQuestions(structuredQuestions);
          setStep(3);
          setOcrProgress(100);
        } catch (iaError) {
          console.warn("IA falló (posible falta de saldo). Activando Motor de Emergencia (Regex)...", iaError);
          const fallbackQs = parseQuestionsFromText(fullText);
          setQuestions(fallbackQs);
          setStep(3);
          setOcrProgress(100);
        }

      } else {
          setErrorMessage("No hay API Key configurada.");
          setStep(1);
      }
    } catch (error) {
      console.error("❌ [DEBUG ERROR] FALLO COMPLETO:", error);
      setErrorMessage(error.message);
      setStep(1);
    }
  };

  // Motor de emergencia (Regex) — v4 ultra-permisivo (sin dependencia de espacios)
  const parseQuestionsFromText = (text) => {
    console.log("================ TEXTO CRUDO DEL PDF ================");
    console.log(text);
    console.log("====================================================");

    const qs = [];
    const normalizedText = text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').replace(/[•◦▪●]/g, '○');

    // Divide ignorando si hay o no espacios después del número
    const rawQuestions = normalizedText.split(/(?=\b\d{1,3}[.)-]\s*)/);

    rawQuestions.forEach(qBlock => {
      if (qBlock.trim().length < 5) return;

      // Busca incisos o círculos pegados a la letra/símbolo (sin espacio obligatorio)
      const optionsRegex = /(?:\b[a-eA-E][.)\]\-:]|○)/;
      const optionsIndex = qBlock.search(optionsRegex);

      if (optionsIndex !== -1 && optionsIndex > 3) {
        const qText = qBlock.substring(0, optionsIndex).replace(/^\d{1,3}[.)-]\s*/, '').trim();
        const optionsStr = qBlock.substring(optionsIndex);
        const options = [];

        const optRegex = /(?:\b([a-eA-E])[.)\]\-:]\s*|○\s*)([\s\S]*?)(?=(?:\b[a-eA-E][.)\]\-:]|○|$))/g;

        let match;
        let bulletIndex = 0;
        const alphabet = ['a', 'b', 'c', 'd', 'e'];

        while ((match = optRegex.exec(optionsStr)) !== null) {
          const id = match[1] ? match[1].toLowerCase() : alphabet[bulletIndex];
          const textOpt = match[2].trim();
          if (textOpt) {
            options.push({ id: id, text: textOpt });
            bulletIndex++;
          }
        }

        if (options.length >= 2) {
          qs.push({
            id: Math.random().toString(36).substring(2, 11),
            type: 'multiple',
            text: qText,
            options: options,
            correctOption: options[0]?.id || 'a'
          });
        } else {
          qs.push({
            id: Math.random().toString(36).substring(2, 11),
            type: 'open',
            text: qBlock.replace(/^\d{1,3}[.)-]\s*/, '').trim(),
            options: [],
            correctOption: null
          });
        }
      } else {
        qs.push({
          id: Math.random().toString(36).substring(2, 11),
          type: 'open',
          text: qBlock.replace(/^\d{1,3}[.)-]\s*/, '').trim(),
          options: [],
          correctOption: null
        });
      }
    });
    return qs;
  };

  const handleCreateRoom = async () => {
    if (questions.length === 0) {
      setErrorMessage('El examen está vacío.');
      return;
    }
    setLoading(true);
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
    
    try {
      // 1. Guardar el examen en el nuevo esquema híbrido
      const datosDelExamen = {
        titulo: examTitle,
        tipo: 'nativo',
        pin_sala: generatedPin
      };

      const { data: examData, error: examError } = await supabase
        .from('exams')
        .insert([datosDelExamen])
        .select();

      if (examError) throw examError;

      const newExamId = examData[0].id;

      // 2. Guardar preguntas y opciones con su columna 'es_correcta' de forma segura
      for (const q of questions) {
        const { data: qData, error: qError } = await supabase
          .from('questions')
          .insert([{ exam_id: newExamId, texto_pregunta: q.text }])
          .select();
          
        if (qError) throw qError;
        
        if (q.options && q.options.length > 0) {
          const opsToInsert = q.options.map(opt => ({
            question_id: qData[0].id,
            texto_opcion: opt.text,
            es_correcta: opt.id === q.correctOption
          }));
          const { error: optError } = await supabase.from('options').insert(opsToInsert);
          if (optError) throw optError;
        }
      }

      setPin(generatedPin);
      setStep(4);
    } catch (err) {
        setErrorMessage(`Error al publicar: ${err.message}`);
    } finally {
        setLoading(false);
    }
  };

  const handlePublishExternalLink = async () => {
    if (!externalLink || externalLink.trim() === '') {
      setErrorMessage('Por favor, ingresa un enlace válido.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
    
    try {
      const datosDelExamen = {
        titulo: examTitle,
        tipo: 'externo',
        pin_sala: generatedPin,
        url_formulario: externalLink.trim()
      };

      const { error } = await supabase
        .from('exams')
        .insert([datosDelExamen]);

      if (error) throw error;

      setPin(generatedPin);
      setStep(4);
    } catch (err) {
        setErrorMessage(`Error al publicar enlace: ${err.message}`);
    } finally {
        setLoading(false);
    }
  };

  const addManualQuestion = (type) => {
    const newQ = { 
        id: Date.now(), 
        type, 
        text: '', 
        options: type === 'multiple' ? [{id:'a',text:''},{id:'b',text:''},{id:'c',text:''},{id:'d',text:''}] : [], 
        correctOption: type === 'multiple' ? 'a' : null 
    };
    setQuestions([...questions, newQ]);
  };

  // --- RENDERIZADO DE INTERFAZ ---

  if (step === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
        <div className="max-w-5xl w-full">
           <h2 className={cn("text-3xl font-black text-center mb-2", darkMode ? "text-white" : "text-black")}>Motor de Exámenes V3</h2>
           <p className="text-sm text-neutral-500 mb-12 text-center">IA de lectura real (PDF/OCR). Sin límites.</p>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <ModeButton onClick={() => { setImportMode('ai'); setStep(1); }} icon={<Wand2 className="w-6 h-6" />} title="Lectura IA" desc="PDF o Imágenes" color="blue" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('manual'); setQuestions([]); addManualQuestion('multiple'); setStep(3); }} icon={<Layout className="w-6 h-6" />} title="Manual" desc="Escribir preguntas" color="purple" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('link'); setStep(5); }} icon={<LinkIcon className="w-6 h-6" />} title="Google Forms" desc="Importar link" color="emerald" dark={darkMode} />
              <ModeButton onClick={() => { setImportMode('link'); setStep(5); }} icon={<FileCode2 className="w-6 h-6" />} title="MS Forms" desc="Importar link" color="cyan" dark={darkMode} />
           </div>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-xl w-full p-10 rounded-[32px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
          <button onClick={() => setStep(0)} className="text-xs font-bold text-neutral-400 hover:text-blue-500 mb-8 flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Volver</button>
          
          <div className="mb-8">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 block">Título del Examen</label>
            <input type="text" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className={cn("w-full bg-transparent border-b-2 py-3 font-black text-2xl focus:outline-none transition-colors", darkMode ? "border-white/5 text-white focus:border-blue-500" : "border-neutral-100 text-black focus:border-blue-500")} />
          </div>

          <input type="file" ref={fileInputRef} onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0])} className="hidden" accept="image/*,.pdf" />
          <div className="mt-2 text-sm text-yellow-600 bg-yellow-50 p-2 rounded border border-yellow-200">
            <strong>Nota del sistema:</strong> El lector de documentos está operando en modo de procesamiento local (sin conexión a la nube). Te sugerimos revisar que las preguntas de opción múltiple se hayan estructurado correctamente antes de guardar el examen.
          </div>
          <button onClick={() => fileInputRef.current.click()} className={cn("w-full flex flex-col items-center justify-center h-56 border-2 border-dashed rounded-[24px] transition-all group", darkMode ? "border-neutral-800 bg-black/20 hover:border-blue-500" : "border-neutral-200 bg-neutral-50 hover:border-blue-400")}>
            <Upload className="w-10 h-10 text-neutral-400 group-hover:text-blue-500 mb-4" />
            <span className={cn("text-sm font-black", darkMode ? "text-white" : "text-black")}>Seleccionar PDF o Imagen</span>
          </button>
          
          {errorMessage && <div className="mt-6 p-4 rounded-xl bg-red-50 text-red-600 text-xs font-bold">{errorMessage}</div>}
        </motion.div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] text-center">
        <div className="relative mb-8">
            <div className={cn("w-24 h-24 rounded-full border-4 animate-spin", darkMode ? "border-white/5 border-t-blue-500" : "border-neutral-100 border-t-blue-500")} />
            <div className="absolute inset-0 flex items-center justify-center text-xl font-black text-blue-500">{ocrProgress}%</div>
        </div>
        <h2 className={cn("text-xl font-black mb-2", darkMode ? "text-white" : "text-black")}>Procesando con IA</h2>
        <p className="text-xs text-neutral-500 animate-pulse">{ocrStatus}</p>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className={cn("h-full flex flex-col", darkMode ? "bg-black" : "bg-neutral-50")}>
        <div className={cn("flex items-center justify-between px-8 py-5 border-b sticky top-0 z-20", darkMode ? "border-white/10 bg-[#111111]" : "border-neutral-200 bg-white shadow-sm")}>
          <div className="flex items-center gap-4">
             <button onClick={() => setStep(0)} className={cn("p-2 rounded-xl transition-colors", darkMode ? "text-white hover:bg-white/10" : "text-black hover:bg-neutral-100")}><ChevronLeft className="w-6 h-6" /></button>
             <input type="text" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className={cn("bg-transparent border-none p-0 font-black text-xl focus:ring-0", darkMode ? "text-white" : "text-black")} />
          </div>
          <button onClick={handleCreateRoom} disabled={loading} className="px-8 py-3 bg-blue-600 text-white text-sm font-black rounded-[18px] hover:scale-[1.02] transition-all shadow-xl shadow-blue-500/20 disabled:opacity-50">
            {loading ? 'Publicando...' : 'Publicar Examen'} <ArrowRight className="inline ml-2 w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-10">
          <div className="max-w-4xl mx-auto space-y-8 pb-32">
            {questions.map((q, index) => (
              <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("p-10 rounded-[32px] border relative transition-all group", darkMode ? "bg-[#111111] border-white/10 hover:border-blue-500/30" : "bg-white border-neutral-200 hover:shadow-xl")}>
                <div className="absolute top-6 right-6 flex items-center gap-2">
                    <button onClick={() => { const n = [...questions]; n[index].type = n[index].type === 'multiple' ? 'open' : 'multiple'; setQuestions(n); }} className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors", darkMode ? "bg-white/5 text-neutral-400 hover:bg-blue-500 hover:text-white" : "bg-neutral-100 text-neutral-600 hover:bg-blue-600 hover:text-white")}>
                        {q.type === 'multiple' ? 'Opción Múltiple' : 'Abierta'}
                    </button>
                    <button onClick={() => setQuestions(questions.filter(item => item.id !== q.id))} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"><Trash2 className="w-5 h-5" /></button>
                </div>

                <div className="flex items-start gap-6 mb-8">
                  <span className={cn("flex items-center justify-center w-10 h-10 rounded-2xl text-xs font-black shrink-0", darkMode ? "bg-neutral-800 text-neutral-400" : "bg-neutral-100 text-neutral-500")}>{index + 1}</span>
                  <textarea value={q.text} onChange={(e) => { const n = [...questions]; n[index].text = e.target.value; setQuestions(n); }} className={cn("w-full text-lg font-black bg-transparent border-none p-0 focus:ring-0 resize-none leading-relaxed", darkMode ? "text-white" : "text-neutral-900")} rows={2} />
                </div>

                {q.type === 'multiple' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-16">
                    {q.options.map((opt) => {
                      const isSelected = q.correctOption === opt.id;
                      return (
                        <div key={opt.id} className={cn("flex items-center gap-4 px-5 py-4 rounded-[20px] border transition-all", isSelected ? "border-green-500 bg-green-500/10 ring-1 ring-green-500" : (darkMode ? "border-white/5" : "border-neutral-100"))}>
                          <button onClick={() => { const n = [...questions]; n[index].correctOption = opt.id; setQuestions(n); }} className={cn("w-6 h-6 rounded-full border-2 flex items-center justify-center", isSelected ? "bg-green-500 border-green-500" : "border-neutral-300")}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </button>
                          <input type="text" value={opt.text} onChange={(e) => { 
                                const n = [...questions]; 
                                const oi = n[index].options.findIndex(o => o.id === opt.id);
                                n[index].options[oi].text = e.target.value;
                                setQuestions(n);
                            }} className={cn("flex-1 text-sm font-bold bg-transparent border-none p-0 focus:ring-0", darkMode ? "text-neutral-200" : "text-neutral-700")} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ))}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button onClick={() => addManualQuestion('multiple')} className="py-10 border-2 border-dashed rounded-[32px] flex flex-col items-center justify-center gap-3"><ListChecks className="w-8 h-8 text-neutral-400" /><span className="text-xs font-black uppercase tracking-widest">Añadir Opción Múltiple</span></button>
                <button onClick={() => addManualQuestion('open')} className="py-10 border-2 border-dashed rounded-[32px] flex flex-col items-center justify-center gap-3"><Type className="w-8 h-8 text-neutral-400" /><span className="text-xs font-black uppercase tracking-widest">Añadir Pregunta Abierta</span></button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={cn("max-w-md w-full p-12 rounded-[48px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
          <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-8"><CheckCircle2 className="w-10 h-10 text-green-600" /></div>
          <h2 className={cn("text-2xl font-black mb-3", darkMode ? "text-white" : "text-black")}>Examen Publicado</h2>
          <div className="py-8 px-6 rounded-3xl mb-12 border-2 border-blue-50 bg-blue-50/50">
             <span className="text-5xl font-mono font-black tracking-[0.2em] text-blue-600 uppercase">{pin}</span>
          </div>
          <button onClick={onComplete} className="w-full py-5 bg-black dark:bg-white dark:text-black text-white rounded-[24px] text-base font-black">Ir al Monitoreo</button>
        </motion.div>
      </div>
    );
  }

  if (step === 5) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-xl w-full p-10 rounded-[32px] border shadow-2xl", darkMode ? "bg-[#111111] border-white/10" : "bg-white border-neutral-200")}>
          <button onClick={() => setStep(0)} className="text-xs font-bold text-neutral-400 hover:text-blue-500 mb-8 flex items-center gap-2"><ChevronLeft className="w-4 h-4" /> Volver</button>
          
          <h2 className={cn("text-2xl font-black mb-6", darkMode ? "text-white" : "text-black")}>Importar desde Formulario Externo</h2>
          
          <div className="mb-8">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 block">Título del Examen</label>
            <input type="text" value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className={cn("w-full bg-transparent border-b-2 py-3 font-black text-2xl focus:outline-none transition-colors", darkMode ? "border-white/5 text-white focus:border-blue-500" : "border-neutral-100 text-black focus:border-blue-500")} />
          </div>

          <div className="mb-8">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 block">URL del Formulario</label>
            <input type="text" value={externalLink} onChange={(e) => setExternalLink(e.target.value)} placeholder="https://forms.gle/..." className={cn("w-full bg-transparent border-b-2 py-3 font-black text-lg focus:outline-none transition-colors", darkMode ? "border-white/5 text-white focus:border-blue-500" : "border-neutral-100 text-black focus:border-blue-500")} />
          </div>

          <button onClick={handlePublishExternalLink} disabled={loading} className="w-full py-4 bg-blue-600 text-white rounded-[24px] text-base font-black hover:scale-[1.02] transition-all shadow-xl shadow-blue-500/20 disabled:opacity-50">
            {loading ? 'Importando...' : 'Importar'}
          </button>
          
          {errorMessage && <div className="mt-6 p-4 rounded-xl bg-red-50 text-red-600 text-xs font-bold">{errorMessage}</div>}
        </motion.div>
      </div>
    );
  }

  return null;
}

function ModeButton({ onClick, icon, title, desc, color, dark }) {
  const colors = { blue: "text-blue-600 bg-blue-50 dark:bg-blue-900/20", purple: "text-purple-600 bg-purple-50 dark:bg-purple-900/20", emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20", cyan: "text-cyan-600 bg-cyan-50 dark:bg-cyan-900/20" };
  return (
    <button onClick={onClick} className={cn("p-10 rounded-[40px] border text-left transition-all hover:border-black group relative overflow-hidden", dark ? "bg-[#111111] border-white/10 hover:border-white" : "bg-white border-neutral-100 hover:shadow-xl")}>
      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mb-8 shadow-md", colors[color])}>{icon}</div>
      <h3 className={cn("font-black text-lg mb-2", dark ? "text-white" : "text-black")}>{title}</h3>
      <p className="text-xs text-neutral-500 font-medium">{desc}</p>
    </button>
  );
}
