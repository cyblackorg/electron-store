/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { environment } from '../../environments/environment'
import { HttpClient } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { catchError, map } from 'rxjs/operators'
import { 
  type ChatMessage, 
  type ChatResponse
} from '../types/chatbot.types'
import { firstValueFrom } from 'rxjs'

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  private readonly apiUrl = environment.hostServer + '/rest/chatbot'

  constructor(private readonly http: HttpClient) {}

  getChatbotStatus() {
    return this.http.get<{ status: boolean, body: string, action?: string }>(`${this.apiUrl}/status`)
  }

  getMessages() {
    return this.http.get<Array<{ message: string, role: 'user' | 'assistant', timestamp: string, action?: any }>>(`${this.apiUrl}/messages`).pipe(
      map(messages => messages.map(msg => ({
        message: msg.message,
        role: msg.role,
        timestamp: msg.timestamp,
        action: msg.action
      })))
    )
  }

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      // Store user message
      await this.saveMessage({
        message,
        role: 'user'
      })
      
      // Call the backend chatbot API directly
      const response = await firstValueFrom(
        this.http.post<{ body: string, action?: string, token?: string }>(`${this.apiUrl}/respond`, {
          query: message
        })
      )
      
      // Store bot response
      await this.saveMessage({
        message: response.body,
        role: 'assistant'
      })

      return {
        text: response.body,
        action: response.action ? { type: response.action } : undefined
      }
    } catch (error) {
      console.error('Error in chatbot:', error)
      return {
        text: 'I apologize, but I encountered an error. Please try again.',
        error: true
      }
    }
  }

  private async saveMessage(message: ChatMessage): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.apiUrl}/messages`, message)
      )
    } catch (error) {
      console.error('Error saving message:', error)
    }
  }

  async clearHistory(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}/messages`)
      )
    } catch (error) {
      console.error('Error clearing history:', error)
    }
  }
}
