import React from 'react';
import { motion } from 'framer-motion';
import { 
  ShieldCheck, Eye, BarChart, Zap, Lock, 
  CheckCircle2, ArrowRight, Play, Server, Users, MonitorSmartphone
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function MarketingLanding({ onGoToLogin }) {
  const handleCheckout = async (planType) => {
    try {
      // 1. Generamos un ID de cliente (o usamos uno existente si el usuario estuviera logueado)
      // Para la demo de la tesis, generamos uno temporal y lo guardamos
      const clientId = crypto.randomUUID();
      localStorage.setItem('centinela_pending_client_id', clientId);

      // Llamada al endpoint local de Flask
      const response = await fetch('http://localhost:5000/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: planType, clientId: clientId }),
      });

      const data = await response.json();

      if (data.url) {
        // Redirigir al usuario al Checkout seguro alojado por Stripe
        window.location.href = data.url;
      } else {
        console.error("Error en la respuesta del servidor:", data.error);
      }
    } catch (error) {
      console.error("Error al conectar con el backend:", error);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-blue-500/30">
      
      {/* ── NAVBAR ──────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-600/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-black tracking-tighter uppercase">Centinela IA</span>
          </div>
          <div className="flex items-center gap-6">
            <button 
              onClick={onGoToLogin}
              className="text-sm font-bold text-neutral-400 hover:text-white transition-colors"
            >
              Portal de Acceso
            </button>
            <button 
              onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
              className="px-6 py-2.5 bg-white text-black rounded-full text-sm font-bold hover:bg-neutral-200 transition-colors"
            >
              Adquirir Licencia
            </button>
          </div>
        </div>
      </nav>

      {/* ── 1. HERO SECTION ──────────────────────────────── */}
      <section className="relative pt-40 pb-20 overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center max-w-4xl mx-auto mb-16">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold tracking-widest uppercase mb-8"
            >
              <Zap className="w-4 h-4" />
              El estándar en evaluación digital
            </motion.div>
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl font-black tracking-tighter leading-[1.1] mb-6"
            >
              Garantiza la <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Integridad Académica</span> en Cada Evaluación.
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-lg md:text-xl text-neutral-400 mb-10 max-w-2xl mx-auto leading-relaxed"
            >
              Centinela IA es la plataforma de monitoreo automatizado con inteligencia artificial que protege el prestigio de tu institución y facilita la labor docente.
            </motion.p>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <button 
                onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
                className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-xl shadow-blue-600/25 flex items-center justify-center gap-2"
              >
                Adquirir Licencia Institucional <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>
          </div>

          {/* MOCKUP UI */}
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="relative mx-auto max-w-5xl"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/20 to-transparent blur-3xl rounded-[40px] -z-10" />
            <div className="rounded-[24px] border border-white/10 bg-neutral-900 p-2 shadow-2xl">
              <div className="rounded-[18px] overflow-hidden bg-neutral-950 border border-white/5">
                {/* Header del Mockup */}
                <div className="h-12 border-b border-white/10 flex items-center px-6 gap-4">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  <div className="flex-1 flex justify-center">
                    <div className="h-6 w-64 bg-white/5 rounded-full" />
                  </div>
                </div>
                {/* Contenido del Mockup */}
                <div className="p-8 grid grid-cols-3 gap-6">
                  <div className="col-span-2 space-y-6">
                    <div className="h-8 w-48 bg-white/10 rounded-lg" />
                    <div className="grid grid-cols-3 gap-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white/5 border border-white/10 p-4 rounded-xl flex flex-col gap-3">
                          <div className="flex justify-between items-center">
                            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                              <Users className="w-5 h-5 text-blue-400" />
                            </div>
                            <div className="w-16 h-6 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-green-400">SEGURO</span>
                            </div>
                          </div>
                          <div className="h-4 w-24 bg-white/10 rounded" />
                          <div className="h-3 w-16 bg-white/5 rounded" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="col-span-1 border-l border-white/10 pl-6 space-y-6">
                    <div className="h-8 w-32 bg-white/10 rounded-lg" />
                    <div className="space-y-3">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-12 w-full bg-white/5 rounded-lg border border-white/5" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── 2. EL PROBLEMA ──────────────────────────────── */}
      <section className="py-24 border-y border-white/5 bg-neutral-900/50">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-black tracking-tighter mb-6">
            El reto de la evaluación digital hoy en día.
          </h2>
          <p className="text-xl text-neutral-400 leading-relaxed">
            La transición a los exámenes digitales ha incrementado los casos de deshonestidad académica. Los profesores invierten demasiadas horas intentando supervisar manualmente a decenas de estudiantes a través de pantallas, obteniendo resultados poco precisos y un alto desgaste.
          </p>
        </div>
      </section>

      {/* ── 3. LA SOLUCIÓN ──────────────────────────────── */}
      <section className="py-32 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6">
              Supervisión Inteligente,<br/>Automática y Segura.
            </h2>
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
              Nuestra ingeniería biométrica trabaja en segundo plano para que tú te enfoques en lo que importa: la educación.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <FeatureCard 
              icon={<Eye />}
              title="Monitoreo Continuo"
              desc="Algoritmos de IA que analizan el comportamiento y los movimientos en tiempo real durante toda la prueba."
            />
            <FeatureCard 
              icon={<BarChart />}
              title="Reportes Automatizados"
              desc="Al finalizar el examen, el profesor recibe un informe detallado con indicadores de confianza por cada alumno, eliminando el análisis manual."
            />
            <FeatureCard 
              icon={<Zap />}
              title="Despliegue Sencillo"
              desc="Pensado para integrarse fácilmente en el flujo de trabajo de profesores y alumnos sin configuraciones complejas."
            />
            <FeatureCard 
              icon={<Lock />}
              title="Privacidad Garantizada"
              desc="Procesamiento seguro de los datos durante la sesión de evaluación. Sin grabaciones invasivas y respetando la privacidad."
            />
          </div>
        </div>
      </section>

      {/* ── 4. PRECIOS / LICENCIAS ──────────────────────── */}
      <section id="pricing" className="py-32 bg-neutral-900/50 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6">
              Planes de Licenciamiento<br/>para tu Universidad.
            </h2>
            <p className="text-xl text-neutral-400">
              Soluciones escalables adaptadas al tamaño de tu institución.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* PLAN DEPARTAMENTAL */}
            <div className="p-8 rounded-[32px] border border-white/10 bg-neutral-950 flex flex-col">
              <h3 className="text-2xl font-bold mb-2">Licencia Departamental</h3>
              <p className="text-neutral-400 text-sm mb-6">Ideal para facultades o departamentos específicos.</p>
              
              <div className="mb-8">
                <span className="text-5xl font-black tracking-tighter">$14,999</span>
                <span className="text-neutral-500 font-medium"> MXN / semestre</span>
              </div>

              <div className="space-y-4 mb-8 flex-1">
                <PricingFeature text="Hasta 500 alumnos simultáneos" />
                <PricingFeature text="Reportes estándar de confianza" />
                <PricingFeature text="Soporte por correo electrónico" />
                <PricingFeature text="Panel docente básico" />
              </div>

              <button 
                onClick={() => handleCheckout('departamental')}
                className="w-full py-4 rounded-xl border border-white/20 hover:bg-white/5 font-bold transition-all"
              >
                Seleccionar Plan
              </button>
            </div>

            {/* PLAN CAMPUS (DESTACADO) */}
            <div className="p-8 rounded-[32px] border border-blue-500/50 bg-gradient-to-b from-blue-900/20 to-neutral-950 flex flex-col relative shadow-2xl shadow-blue-900/20 transform md:-translate-y-4">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-black uppercase tracking-widest px-4 py-1.5 rounded-full">
                Opción Recomendada
              </div>

              <h3 className="text-2xl font-bold mb-2">Licencia Campus</h3>
              <p className="text-blue-200/60 text-sm mb-6">La solución completa para toda la institución.</p>
              
              <div className="mb-8">
                <span className="text-5xl font-black tracking-tighter">$39,999</span>
                <span className="text-neutral-500 font-medium"> MXN / semestre</span>
              </div>

              <div className="space-y-4 mb-8 flex-1">
                <PricingFeature text="Alumnos ilimitados" />
                <PricingFeature text="Integración completa y API" />
                <PricingFeature text="Métricas avanzadas de comportamiento" />
                <PricingFeature text="Soporte técnico prioritario 24/7" />
                <PricingFeature text="Almacenamiento extendido de métricas" />
              </div>

              <button 
                onClick={() => handleCheckout('campus')}
                className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-lg shadow-blue-600/25"
              >
                Seleccionar Plan
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. CIERRE Y FOOTER ────────────────────────── */}
      <section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-blue-600/5" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-600/20 blur-[150px] rounded-full pointer-events-none" />
        
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="text-5xl md:text-6xl font-black tracking-tighter mb-8">
            Da el paso hacia la evaluación del futuro.
          </h2>
          <button 
            onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
            className="px-10 py-5 bg-white text-black rounded-2xl font-black text-lg transition-all hover:scale-105 active:scale-95 shadow-2xl"
          >
            Comenzar con Centinela IA hoy
          </button>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-neutral-950 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-16">
            <div className="col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-blue-500" />
                <span className="font-black tracking-tighter uppercase">Centinela IA</span>
              </div>
              <p className="text-neutral-500 text-sm max-w-sm">
                Protegiendo el prestigio institucional mediante tecnología biométrica avanzada y análisis de comportamiento.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-sm">Producto</h4>
              <ul className="space-y-2 text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors">Características</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Precios</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Casos de Éxito</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-sm">Legal</h4>
              <ul className="space-y-2 text-sm text-neutral-400">
                <li><a href="#" className="hover:text-white transition-colors">Términos y Condiciones</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Política de Privacidad</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Manejo de Datos Biométricos</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-neutral-600 text-xs">
              © 2026 Centinela IA. Todos los derechos reservados.
            </p>
            <p className="text-neutral-600 text-xs flex items-center gap-2">
              Desarrollado para garantizar la excelencia académica.
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}

function FeatureCard({ icon, title, desc }) {
  return (
    <div className="p-8 rounded-[32px] bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
      <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6 text-blue-400">
        {React.cloneElement(icon, { className: 'w-6 h-6' })}
      </div>
      <h3 className="text-2xl font-bold mb-4">{title}</h3>
      <p className="text-neutral-400 leading-relaxed">{desc}</p>
    </div>
  );
}

function PricingFeature({ text }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 className="w-3 h-3 text-blue-400" />
      </div>
      <span className="text-sm text-neutral-300">{text}</span>
    </div>
  );
}
