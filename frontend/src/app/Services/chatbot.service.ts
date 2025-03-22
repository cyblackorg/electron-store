/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { environment } from '../../environments/environment'
import { HttpClient } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { catchError, map } from 'rxjs/operators'
import { LLMService } from './llm.service'
import { ProductService } from './product.service'
import { BasketService } from './basket.service'
import { UserService } from './user.service'
import { OrderHistoryService } from './order-history.service'
import { 
  type ChatMessage, 
  type ChatResponse,
  type ChatIntent,
  type ParsedParameters,
  type ResolvedProduct,
  type ProfileParams,
  type OrderParams,
  type CustomParams
} from '../types/chatbot.types'
import { firstValueFrom } from 'rxjs'

const MATCH_THRESHOLD = 0.8 // Threshold for product name matching confidence

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  private readonly apiUrl = environment.hostServer + '/rest/chatbot'
  private context: any = {}

  constructor(
    private readonly http: HttpClient,
    private readonly llm: LLMService,
    private readonly productService: ProductService,
    private readonly basketService: BasketService,
    private readonly userService: UserService,
    private readonly orderHistoryService: OrderHistoryService
  ) {}

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

  getResponse(action: string, message: string) {
    return this.http.post<{ body: string, action?: string, token?: string }>(`${this.apiUrl}/respond`, {
      action,
      message
    }).pipe(
      map(response => ({
        text: response.body,
        action: response.action
      }))
    )
  }

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      // Store user message
      await this.saveMessage({
        message,
        role: 'user'
      })
      
      // 1. Classify intent
      const intent = await this.llm.classifyIntent(message, this.context)
      
      // 2. Parse parameters based on intent
      const parameters = await this.llm.parseParameters(
        message,
        intent.type,
        this.context,
        this.getParameterSchema(intent.type)
      )

      // 3. Handle the intent
      let response: ChatResponse
      switch (intent.type) {
        case 'product_search':
          response = await this.handleProductSearch(parameters.productSearch ?? {})
          break
        case 'basket':
          response = await this.handleBasketAction(parameters.basket ?? {})
          break
        case 'profile':
          if (!parameters.profile) {
            response = {
              text: 'I couldn\'t understand what you want to do with your profile.',
              error: true
            }
          } else {
            response = await this.handleProfileAction(parameters.profile)
          }
          break
        case 'order':
          if (!parameters.order) {
            response = {
              text: 'I couldn\'t understand what you want to do with orders.',
              error: true
            }
          } else {
            response = await this.handleOrderQuery(parameters.order)
          }
          break
        case 'custom':
          if (!parameters.custom) {
            response = {
              text: 'I couldn\'t understand your custom request.',
              error: true
            }
          } else {
            response = await this.handleCustomAction(parameters.custom)
          }
          break
        default:
          response = await this.handleGeneralQuery(message)
      }

      // Store bot response
      await this.saveMessage({
        message: response.text,
        role: 'assistant'
      })

      // Update context
      this.context = {
        ...this.context,
        lastIntent: intent,
        lastParameters: parameters,
        lastResponse: response
      }

      return response
    } catch (error) {
      console.error('Error in chatbot:', error)
      return {
        text: 'I apologize, but I encountered an error. Please try again.',
        error: true
      }
    }
  }

  private async handleProductSearch(params: any): Promise<ChatResponse> {
    try {
      // Handle empty query to show all products
      const query = params.query || ''
      const products = await firstValueFrom(this.productService.search(query))
      
      if (!products || products.length === 0) {
        return {
          text: query 
            ? `I couldn't find any products matching "${query}".`
            : 'I couldn\'t find any products.',
          suggestions: ['View all products', 'Search by category']
        }
      }

      return {
        text: query
          ? `I found ${products.length} products matching "${query}":`
          : `Here are all ${products.length} available products:`,
        action: {
          type: 'display_products',
          products: products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.description
          }))
        }
      }
    } catch (error) {
      console.error('Error searching products:', error)
      return {
        text: 'Sorry, I had trouble searching for products.',
        error: true
      }
    }
  }

  private async handleBasketAction(params: any): Promise<ChatResponse> {
    if (params.action === 'view') {
      try {
        const basket = await firstValueFrom(
          this.basketService.find(Number(sessionStorage.getItem('bid')))
        )
        
        if (!basket || !basket.Products || basket.Products.length === 0) {
          return {
            text: 'Your basket is empty.',
            suggestions: ['View products', 'Search products']
          }
        }

        return {
          text: 'Here\'s what\'s in your basket:',
          action: {
            type: 'display_basket',
            items: basket.Products.map(p => ({
              name: p.name,
              price: p.price,
              quantity: p.BasketItem.quantity
            }))
          }
        }
      } catch (error) {
        console.error('Error viewing basket:', error)
        return {
          text: 'Sorry, I couldn\'t retrieve your basket.',
          error: true
        }
      }
    }

    if (params.action === 'add') {
      try {
        const product = await this.resolveProductFromName(params.productName)
        
        if (!product) {
          return {
            text: `I couldn't find a product matching "${params.productName}". Could you please be more specific?`,
            suggestions: ['View all products', 'Search products']
          }
        }

        if (product.matches < MATCH_THRESHOLD) {
          return {
            text: `Did you mean "${product.name}"?`,
            requiresConfirmation: true,
            action: {
              type: 'add_to_basket',
              productId: product.id,
              quantity: params.quantity || 1,
              needsConfirmation: true
            }
          }
        }

        // Actually add the item to the basket
        const basketId = sessionStorage.getItem('bid')
        if (!basketId) {
          return {
            text: 'Sorry, I couldn\'t add the item to your basket. Please try refreshing the page.',
            error: true
          }
        }

        await firstValueFrom(
          this.basketService.save({
            ProductId: product.id,
            BasketId: basketId,
            quantity: params.quantity || 1
          })
        )

        return {
          text: `Added ${params.quantity || 1}x ${product.name} to your basket.`,
          success: true,
          action: {
            type: 'basket_updated',
            addedProduct: {
              id: product.id,
              name: product.name,
              quantity: params.quantity || 1
            }
          }
        }
      } catch (error) {
        console.error('Error adding to basket:', error)
        return {
          text: 'Sorry, I couldn\'t add the item to your basket.',
          error: true
        }
      }
    }

    return {
      text: 'I\'m not sure how to handle that basket action.',
      error: true
    }
  }

  private async handleProfileAction(params: ProfileParams): Promise<ChatResponse> {
    if (params.action === 'view') {
      try {
        const profile = await firstValueFrom(this.userService.whoAmI())
        
        if (!profile) {
          return {
            text: 'Sorry, I couldn\'t retrieve your profile.',
            error: true
          }
        }

        return {
          text: 'Here are your profile details:',
          action: {
            type: 'display_profile',
            profile: {
              email: profile.email,
              username: profile.username,
              role: profile.role,
              isAdmin: profile.isAdmin,
              lastLoginIp: profile.lastLoginIp,
              profileImage: profile.profileImage,
              deluxeToken: profile.deluxeToken,
              totpEnabled: profile.totpEnabled
            }
          }
        }
      } catch (error) {
        console.error('Error viewing profile:', error)
        return {
          text: 'Sorry, I couldn\'t retrieve your profile.',
          error: true
        }
      }
    }

    if (params.action === 'update' && params.field && params.value) {
      try {
        await firstValueFrom(
          this.userService.save({ [params.field]: params.value })
        )
        return {
          text: `Updated your ${params.field} successfully.`,
          success: true
        }
      } catch (error) {
        console.error('Error updating profile:', error)
        return {
          text: 'Sorry, I couldn\'t update your profile.',
          error: true
        }
      }
    }

    return {
      text: 'I\'m not sure how to handle that profile action.',
      error: true
    }
  }

  private async handleOrderQuery(params: OrderParams): Promise<ChatResponse> {
    try {
      const orders = await firstValueFrom(this.orderHistoryService.get())
      
      if (params.action === 'status' || params.action === 'details') {
        if (!params.orderId) {
          return {
            text: 'Please provide an order ID.',
            error: true
          }
        }

        const order = orders.find(o => o.orderId === params.orderId)
        if (!order) {
          return {
            text: `I couldn't find order #${params.orderId}.`,
            error: true
          }
        }

        return {
          text: `Here are the details for order #${params.orderId}:`,
          action: {
            type: 'display_order',
            order: {
              id: order.orderId,
              status: order.delivered ? 'Delivered' : 'In Transit',
              total: order.totalPrice,
              items: order.products
            }
          }
        }
      }

      if (params.action === 'track') {
        // Implement order tracking logic
        return {
          text: 'Order tracking is not implemented yet.',
          error: true
        }
      }

      return {
        text: 'I\'m not sure how to handle that order action.',
        error: true
      }
    } catch (error) {
      console.error('Error handling order query:', error)
      return {
        text: 'Sorry, I had trouble retrieving order information.',
        error: true
      }
    }
  }

  private async handleCustomAction(params: CustomParams): Promise<ChatResponse> {
    try {
      // Get the database schema
      const schema = await this.getDatabaseSchema();

      // Generate SQL directly from the user's objective
      const sql = await this.llm.generateSQL(
        params.objective,
        schema,
        { maxLimit: 1000 }
      );

      // Execute the SQL query using the HTTP service since we don't have direct DB access
      const results = await firstValueFrom(
        this.http.post(`${this.apiUrl}/execute-sql`, { sql })
      );

      // Format the results into a readable message
      if (Array.isArray(results) && results.length > 0) {
        const formattedResults = results.map(row => {
          return Object.entries(row)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        }).join('\n');
        return {
          text: `Here are the results:\n${formattedResults}`,
          action: {
            type: 'display_custom_result',
            result: results
          }
        };
      } else {
        return {
          text: 'No results found for your query.',
          suggestions: ['View Products', 'Check Orders', 'View Profile']
        };
      }
    } catch (error) {
      console.error('Error in custom action:', error);
      return {
        text: "I apologize, but I couldn't fulfill your request. Please try being more specific or contact customer support for assistance.",
        error: true
      };
    }
  }

  private getDatabaseSchema(): any {
    return {
      Products: {
        id: 'number',
        name: 'string',
        description: 'string',
        price: 'number',
        image: 'string',
        category: 'string',
        deluxePrice: 'number',
        quantity: 'number'
      },
      Categories: {
        id: 'number',
        name: 'string',
        description: 'string'
      },
      Users: {
        id: 'number',
        username: 'string',
        email: 'string',
        role: 'string',
        lastLoginIp: 'string',
        profileImage: 'string',
        totpSecret: 'string',
        isActive: 'boolean'
      },
      Baskets: {
        id: 'number',
        UserId: 'number',
        coupon: 'string',
        createdAt: 'date'
      },
      BasketItems: {
        BasketId: 'number',
        ProductId: 'number',
        quantity: 'number'
      },
      Feedbacks: {
        id: 'number',
        UserId: 'number',
        comment: 'string',
        rating: 'number',
        createdAt: 'date'
      },
      Complaints: {
        id: 'number',
        UserId: 'number',
        message: 'string',
        file: 'string',
        createdAt: 'date'
      },
      Orders: {
        id: 'number',
        UserId: 'number',
        totalPrice: 'number',
        delivered: 'boolean',
        createdAt: 'date'
      },
      Recycles: {
        id: 'number',
        UserId: 'number',
        quantity: 'number',
        address: 'string',
        isPickup: 'boolean',
        date: 'date'
      },
      SecurityQuestions: {
        id: 'number',
        question: 'string'
      },
      SecurityAnswers: {
        id: 'number',
        UserId: 'number',
        SecurityQuestionId: 'number',
        answer: 'string'
      },
      Wallets: {
        id: 'number',
        UserId: 'number',
        balance: 'number'
      }
    }
  }

  private async resolveProductFromName(productName: string): Promise<ResolvedProduct | null> {
    try {
      const products = await firstValueFrom(
        this.productService.search(productName)
      )
      
      if (!products || products.length === 0) {
        return null
      }

      // Calculate match scores
      const scoredProducts = products.map(product => ({
        id: product.id,
        name: product.name,
        price: product.price,
        matches: this.calculateNameMatchScore(productName, product.name)
      }))

      // Return best match
      return scoredProducts.sort((a, b) => b.matches - a.matches)[0]
    } catch (error) {
      console.error('Error resolving product:', error)
      return null
    }
  }

  private calculateNameMatchScore(search: string, actual: string): number {
    // Simple implementation - can be improved with better matching algorithms
    const searchLower = search.toLowerCase()
    const actualLower = actual.toLowerCase()
    
    if (searchLower === actualLower) return 1
    if (actualLower.includes(searchLower)) return 0.9
    if (searchLower.includes(actualLower)) return 0.8
    
    // Calculate word overlap
    const searchWords = searchLower.split(' ')
    const actualWords = actualLower.split(' ')
    const commonWords = searchWords.filter(word => actualWords.includes(word))
    
    return commonWords.length / Math.max(searchWords.length, actualWords.length)
  }

  private async handleGeneralQuery(message: string): Promise<ChatResponse> {
    try {
      const response = await this.llm.generateResponse(message, this.context)
      return { text: response }
    } catch (error) {
      console.error('Error generating response:', error)
      return {
        text: 'I apologize, but I\'m having trouble understanding. Could you rephrase that?',
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
      this.context = {}
    } catch (error) {
      console.error('Error clearing history:', error)
    }
  }

  private getParameterSchema(intentType: string): any {
    const schemas = {
      product_search: {
        query: "string - The search term or product name",
        category: "string? - Optional product category",
        priceRange: {
          min: "number? - Minimum price",
          max: "number? - Maximum price"
        },
        sortBy: "string? - Sort criteria (price, name, rating)"
      },
      basket: {
        action: "string - One of: view, add, remove, update",
        productName: "string? - Required for add/remove/update",
        quantity: "number? - Required for add/update"
      },
      profile: {
        action: "string - One of: view, update",
        field: "string? - Field to update",
        value: "string? - New value for the field"
      },
      order: {
        action: "string - One of: status, details, track",
        orderId: "string? - Order ID to query"
      },
      custom: {
        objective: "string - What the user wants to achieve",
        tables: "string[] - Tables involved in the operation",
        conditions: "object? - Filter conditions (key-value pairs)",
        fields: "string[]? - Specific fields to retrieve",
        action: "string? - Type of operation (SELECT/INSERT/UPDATE/DELETE)",
        aggregation: {
          field: "string? - Field to aggregate",
          function: "string? - Aggregation function (SUM, COUNT, AVG, etc.)"
        },
        groupBy: "string? - Field to group by",
        orderBy: {
          field: "string? - Field to sort by",
          direction: "string? - ASC or DESC"
        }
      }
    }
    
    return schemas[intentType]
  }
}
