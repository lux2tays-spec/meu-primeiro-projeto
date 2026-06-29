export type BotAction = 'REPLY' | 'SCHEDULE' | 'CANCEL' | 'LIST_SERVICES' | 'LIST_AVAILABILITY' | 'TRANSFER_HUMAN'

export interface AgentConfig {
  id: string
  tenant_id: string
  system_prompt: string
  tone: 'formal' | 'friendly' | 'casual'
  language: string
  business_info: string   // free-text describing the business for the AI
  updated_at: string
}

export interface BotMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface WhatsAppInstance {
  id: string
  tenant_id: string
  instance_name: string
  phone_number: string | null
  status: 'disconnected' | 'qr_pending' | 'connected'
  created_at: string
}
