// WhatsApp message templates for the Cuidador Digital system

export const createWelcomeMessage = (nomeIdoso: string): string => {
  return `🎉 Olá ${nomeIdoso}! Seja bem-vindo ao Cuidador Digital 👵👴

A partir de agora, você receberá lembretes automáticos dos seus medicamentos. 💊

Quando receber um lembrete, responda:
1️⃣ para "Tomei"
2️⃣ para "Não tomei"  
3️⃣ para "Adiar 10 min"

Para parar os lembretes, envie "SAIR".

Vamos cuidar da sua saúde juntos! 💙`;
};

export const createReminderMessage = (nomeIdoso: string, medicacao: string, dosagem: string): string => {
  return `⏰ Olá, ${nomeIdoso} 👋 — Hora do remédio *${medicacao}* (${dosagem})

Responda:
1️⃣ ✅ Tomei
2️⃣ ❌ Não tomei  
3️⃣ ⏳ Adiar 10 min`;
};

export const createConfirmationMessage = (nomeIdoso: string, medicacao: string, response: '1' | '2' | '3'): string => {
  const messages = {
    '1': `Perfeito, ${nomeIdoso}! ✔️ Registramos que você tomou *${medicacao}*. Obrigado! 💙`,
    '2': `Entendido, ${nomeIdoso}. Foi registrado que *${medicacao}* não foi tomado. Se precisar de ajuda, fale com seu responsável. 🤗`,
    '3': `Ok, ${nomeIdoso}! Vamos lembrar de novo em 10 minutos — responda 1 quando tomar 😊`
  };
  
  return messages[response] || `Não entendi sua resposta "${response}". Responda: 1, 2 ou 3.`;
};

export const createEmergencyAlert = (nomeIdoso: string, medicacao: string, hora: string): string => {
  return `⚠️ *ALERTA DE MEDICAÇÃO*

${nomeIdoso} não confirmou o remédio *${medicacao}* das ${hora}.

Por favor, verifique se está tudo bem. 🚨`;
};

export const createDailyReport = (
  nomeIdoso: string, 
  stats: { tomou: number; total: number; naoTomou: number; adiado: number }
): string => {
  const adherenceRate = stats.total > 0 ? Math.round((stats.tomou / stats.total) * 100) : 0;
  
  return `📊 *Relatório Diário - ${nomeIdoso}*

✅ Medicamentos tomados: ${stats.tomou}
❌ Não tomados: ${stats.naoTomou}
⏳ Adiados: ${stats.adiado}
📋 Total de lembretes: ${stats.total}

Taxa de adesão: ${adherenceRate}%

Continue assim! 💪`;
};

export const createOptOutConfirmation = (nomeIdoso: string): string => {
  return `${nomeIdoso}, os lembretes foram interrompidos conforme solicitado. ✋

Para reativar, entre em contato com seu responsável.

Cuide-se! 💙`;
};

export const validatePhoneNumber = (phone: string): boolean => {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Brazilian phone numbers should have 10 or 11 digits
  return digits.length === 10 || digits.length === 11;
};

export const formatPhoneForWhatsApp = (phone: string): string => {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Add country code if not present
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  
  return digits;
};