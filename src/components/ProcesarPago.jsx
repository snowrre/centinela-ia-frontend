import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle } from 'lucide-react';

export default function ProcesarPago({ clientId, onVerificationSuccess }) {
  const [status, setStatus] = useState('verificando'); // 'verificando', 'exitoso', 'error'

  useEffect(() => {
    if (!clientId) return;

    // 0. Verificar si el pago ya se procesó antes de que cargara esta página
    const verificarEstadoActual = async () => {
      const { data, error } = await supabase
        .from('universidades')
        .select('licencia_activa')
        .eq('id', clientId)
        .single();
      
      if (data && data.licencia_activa) {
        setStatus('exitoso');
        setTimeout(() => {
          onVerificationSuccess(data);
        }, 2500);
      }
    };
    
    verificarEstadoActual();

    // 1. Crear el canal para escuchar cambios en tiempo real en la tabla 'universidades'
    const canalRealtime = supabase
      .channel('cambios-licencia')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'universidades',
          filter: `id=eq.${clientId}`, // Escucha solo los cambios de esta universidad
        },
        (payload) => {
          // 2. Si el webhook de Flask ya cambió la licencia a true, reaccionamos de inmediato
          if (payload.new && payload.new.licencia_activa === true) {
            setStatus('exitoso');
            
            // Esperamos un momento para que el usuario vea la animación de éxito antes de avanzar
            setTimeout(() => {
              onVerificationSuccess(payload.new);
            }, 2500);
          }
        }
      )
      .subscribe();

    // Limpieza del componente al desmontarse
    return () => {
      supabase.removeChannel(canalRealtime);
    };
  }, [clientId, onVerificationSuccess]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] p-6 text-center">
      {status === 'verificando' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center p-10 bg-white/5 border border-white/10 rounded-3xl backdrop-blur-md"
        >
          <Loader2 className="w-16 h-16 text-blue-500 animate-spin mb-6" />
          <h2 className="text-2xl font-black tracking-tighter text-white">Verificando pago institucional</h2>
          <p className="text-neutral-400 mt-4 max-w-sm leading-relaxed">
            Estamos confirmando la transacción con Stripe. Tu panel se activará de forma automática en unos segundos sin necesidad de recargar la página.
          </p>
        </motion.div>
      )}

      {status === 'exitoso' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center p-10 bg-white/5 border border-green-500/30 rounded-3xl backdrop-blur-md shadow-[0_0_40px_rgba(34,197,94,0.15)]"
        >
          <CheckCircle className="w-20 h-20 text-green-500 mb-6" />
          <h2 className="text-2xl font-black tracking-tighter text-white">¡Licencia Activada Correctamente!</h2>
          <p className="text-green-400/80 mt-4 max-w-sm leading-relaxed font-medium">
            Transacción confirmada en tiempo real. Redirigiéndote al portal de acceso de Centinela IA...
          </p>
        </motion.div>
      )}
    </div>
  );
}
