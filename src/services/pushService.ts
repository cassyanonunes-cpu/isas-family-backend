import prisma from '../utils/prisma';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export const pushService = {
  /**
   * Envia notificação genérica (Mensagem)
   * No Android utiliza FCM, no iOS utiliza APNs
   */
  sendNotification: async (userId: string, payload: PushPayload) => {
    try {
      const devices = await prisma.device.findMany({
        where: { userId, isActive: true, pushToken: { not: null } }
      });

      for (const device of devices) {
        if (!device.pushToken) continue;
        
        console.log(`[PushService] Enviando notificação para ${device.platform} (Token: ${device.pushToken})`, payload);
        // Implementar integração com Firebase Admin (Android) / APNs (iOS)
        // const message = { notification: { title: payload.title, body: payload.body }, data: payload.data, token: device.pushToken };
        // await admin.messaging().send(message);
      }
    } catch (error) {
      console.error('[PushService] Erro ao enviar notificação:', error);
    }
  },

  /**
   * Envia VoIP Push (Chamada de voz/vídeo em Background)
   * No Android utiliza FCM High Priority (Data Message).
   * No iOS utiliza APNs via PushKit (voipToken).
   */
  sendVoipPush: async (userId: string, callId: string, callerName: string, type: string) => {
    try {
      const devices = await prisma.device.findMany({
        where: { userId, isActive: true }
      });

      for (const device of devices) {
        if (device.platform === 'IOS' && device.voipToken) {
          console.log(`[PushService] Enviando VoIP PushKit para iOS (Token: ${device.voipToken})`, { callId, callerName, type });
          // Implementação APNs voip node-apn
        } else if (device.platform === 'ANDROID' && device.pushToken) {
          console.log(`[PushService] Enviando High Priority FCM para Android (Token: ${device.pushToken})`, { callId, callerName, type });
          // Implementação Firebase Admin FCM Data Only High Priority
        }
      }
    } catch (error) {
      console.error('[PushService] Erro ao enviar VoIP Push:', error);
    }
  }
};
