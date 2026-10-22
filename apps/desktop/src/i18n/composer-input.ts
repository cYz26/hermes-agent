import type { BundledLocale } from './types'
import type { ComposerInputTranslations } from './types_composer_input'

// Other composer copy stays in each locale; Japanese still inherits `steer` from English.
export const composerInputCopy = {
  en: {
    startVoice: 'Start voice conversation',
    openDirective: 'Open',
    queueMessage: 'Queue message',
    steer: 'Steer the current run',
    stop: 'Stop',
    send: 'Send'
  },
  zh: {
    startVoice: '开始语音对话',
    openDirective: '打开',
    queueMessage: '排队消息',
    steer: '引导当前运行',
    stop: '停止',
    send: '发送'
  },
  ja: {
    startVoice: '音声会話を開始',
    openDirective: '開く',
    queueMessage: 'メッセージをキューに入れる',
    stop: '停止',
    send: '送信'
  },
  ru: {
    startVoice: 'Начать голосовой разговор',
    openDirective: 'Открыть',
    queueMessage: 'Вставить сообщение в очередь',
    steer: 'Направить текущий запуск',
    stop: 'Стоп',
    send: 'Отправить'
  },
  fr: {
    startVoice: 'Démarrer la conversation vocale',
    openDirective: 'Ouvrir',
    queueMessage: "Mettre le message en file d'attente",
    steer: "Diriger l'exécution en cours",
    stop: 'Arrêter',
    send: 'Envoyer'
  },
  de: {
    startVoice: 'Sprachkonversation starten',
    openDirective: 'Öffnen',
    queueMessage: 'Nachricht einreihen',
    steer: 'Laufenden Lauf steuern',
    stop: 'Stopp',
    send: 'Senden'
  },
  es: {
    startVoice: 'Iniciar conversación de voz',
    openDirective: 'Abrir',
    queueMessage: 'Poner mensaje en cola',
    steer: 'Guiar la ejecución actual',
    stop: 'Detener',
    send: 'Enviar'
  }
} satisfies Record<Exclude<BundledLocale, 'ar' | 'zh-hant'>, Partial<ComposerInputTranslations>>
