import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { type ChatIntent, type ParsedParameters } from '../types/chatbot.types';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LLMService {
  private readonly apiUrl = environment.hostServer + '/rest/llm';

  constructor(private readonly http: HttpClient) {}

  async classifyIntent(message: string, context: any = {}): Promise<ChatIntent> {
    const response = await firstValueFrom(
      this.http.post<ChatIntent>(`${this.apiUrl}/classify`, {
        message,
        context
      })
    );
    return response;
  }

  async parseParameters(
    message: string,
    intentType: string,
    context: any = {},
    schema: any
  ): Promise<ParsedParameters> {
    const response = await firstValueFrom(
      this.http.post<ParsedParameters>(`${this.apiUrl}/parse`, {
        message,
        intentType,
        context,
        schema
      })
    );
    return response;
  }

  async generateResponse(
    message: string,
    context: any = {}
  ): Promise<string> {
    const response = await firstValueFrom(
      this.http.post<{text: string}>(`${this.apiUrl}/generate`, {
        message,
        context
      })
    );
    return response.text;
  }

  async generateSQL(
    message: string,
    schema: any,
    safetyRules: any
  ): Promise<string> {
    const response = await firstValueFrom(
      this.http.post<{sql: string}>(`${this.apiUrl}/sql`, {
        message,
        schema,
        safetyRules
      })
    );
    return response.sql;
  }
} 