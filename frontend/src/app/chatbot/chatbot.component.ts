/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { ChatbotService } from '../Services/chatbot.service'
import { UserService } from '../Services/user.service'
import { Component, type OnDestroy, type OnInit } from '@angular/core'
import { UntypedFormControl, FormsModule, ReactiveFormsModule } from '@angular/forms'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faBomb } from '@fortawesome/free-solid-svg-icons'
import { FormSubmitService } from '../Services/form-submit.service'
import { TranslateService, TranslateModule } from '@ngx-translate/core'
import { CookieService } from 'ngy-cookie'
import { MatInputModule } from '@angular/material/input'
import { MatFormFieldModule, MatLabel } from '@angular/material/form-field'
import { NgFor, NgIf } from '@angular/common'
import { MatCardModule } from '@angular/material/card'
import { FlexModule } from '@angular/flex-layout/flex'
import { ChatMessageComponent } from './chat-message.component'

library.add(faBomb)

enum MessageSources {
  user = 'user',
  bot = 'bot'
}

interface ChatMessage {
  author: MessageSources.user | MessageSources.bot
  body: string
  action?: {
    type: string
    [key: string]: any
  }
}

interface MessageActions {
  response: string
  namequery: string
}

@Component({
  selector: 'app-chatbot',
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss'],
  standalone: true,
  imports: [MatCardModule, FlexModule, NgIf, NgFor, MatFormFieldModule, MatLabel, MatInputModule, FormsModule, ReactiveFormsModule, TranslateModule, ChatMessageComponent]
})
export class ChatbotComponent implements OnInit, OnDestroy {
  public messageControl: UntypedFormControl = new UntypedFormControl()
  public messages: ChatMessage[] = []
  public botAvatarSrc: string = 'assets/public/images/VoltyBot.png'
  public profileImageSrc: string = 'assets/public/images/uploads/default.svg'
  public messageActions: MessageActions = {
    response: 'query',
    namequery: 'setname'
  }
  public currentAction: string = this.messageActions.response

  private chatScrollDownTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor (
    private readonly userService: UserService,
    private readonly chatbotService: ChatbotService,
    private readonly cookieService: CookieService,
    private readonly formSubmitService: FormSubmitService,
    private readonly translate: TranslateService
  ) { }

  ngOnDestroy (): void {
    if (this.chatScrollDownTimeoutId) {
      clearTimeout(this.chatScrollDownTimeoutId)
    }
  }

  ngOnInit (): void {
    // First get the chatbot status (greeting message)
    this.chatbotService.getChatbotStatus().subscribe(
      (response) => {
        // Add the greeting message first
        this.messages = [{
          author: MessageSources.bot,
          body: response.body
        }]
        this.scrollToBottom()
        
        // Then load any existing messages
        this.chatbotService.getMessages().subscribe(
          (messages) => {
            // Only add user messages and bot responses, skip if it's the same as greeting
            const existingMessages = messages.filter(msg => 
              msg.role === 'user' || 
              (msg.role === 'assistant' && msg.message !== response.body)
            ).map(msg => ({
              author: msg.role === 'user' ? MessageSources.user : MessageSources.bot,
              body: msg.message,
              action: msg.action
            }))
            
            // Add existing messages after the greeting
            this.messages.push(...existingMessages)
            this.scrollToBottom()
          },
          (err) => console.error('Error loading messages:', err)
        )
      },
      (err) => console.error('Error getting status:', err)
    )

    this.userService.whoAmI().subscribe(
      (user: any) => {
        this.profileImageSrc = user.profileImage || 'assets/public/images/uploads/default.svg'
      },
      (err) => console.error('Error loading user profile:', err)
    )
  }

  handleResponse (response) {
    this.messages.push({
      author: MessageSources.bot,
      body: response.body
    })
    this.currentAction = this.messageActions[response.action]
    if (response.token) {
      localStorage.setItem('token', response.token)
      const expires = new Date()
      expires.setHours(expires.getHours() + 8)
      this.cookieService.put('token', response.token, { expires })
    }
  }

  async sendMessage(): Promise<void> {
    const messageText = this.messageControl.value
    if (!messageText?.trim()) return

    this.messages.push({
      author: MessageSources.user,
      body: messageText
    })
    this.messageControl.setValue('')
    this.scrollToBottom()

    try {
      const response = await this.chatbotService.sendMessage(messageText)
      
      this.messages.push({
        author: MessageSources.bot,
        body: response.text,
        action: response.action
      })
      this.scrollToBottom()

    } catch (error) {
      console.error('Error sending message:', error)
      this.messages.push({
        author: MessageSources.bot,
        body: this.translate.instant('CHAT_ERROR_MESSAGE')
      })
      this.scrollToBottom()
    }
  }

  private scrollToBottom(): void {
    this.chatScrollDownTimeoutId = setTimeout(() => {
      const chat = document.getElementById('chat-window')
      if (chat) {
        chat.scrollTop = chat.scrollHeight
      }
      this.chatScrollDownTimeoutId = null
    }, 100)
  }
}
