/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 * 
 * Fully LLM-powered Chatbot Implementation
 */

import { type Request, type Response, type NextFunction } from 'express'
import { type User } from '../data/types'
import { UserModel } from '../models/user'
import jwt from 'jsonwebtoken'
import logger from '../lib/logger'
import config from 'config'
import * as utils from '../lib/utils'
import * as security from '../lib/insecurity'
import * as chatbot from '../lib/chatbot'
import { ChatModel } from '../models/chat'
import { sequelize } from '../models'

// For backward compatibility with tests
export const bot = {
  addUser: (id: string, username: string) => {
    logger.info(`Adding user ${username} with ID ${id} to bot`)
    return id // Just to maintain interface compatibility
  },
  train: () => {
    logger.info('Training bot (no-op for LLM-powered chatbot)')
    return Promise.resolve()
  },
  greet: (userId: string) => {
    return chatbot.getGreeting()
  }
}

// Backward compatibility function for tests
export async function initialize() {
  logger.info('Initializing LLM-powered chatbot')
  return Promise.resolve()
}

// Helper functions
async function getUserFromJwt (token: string): Promise<User | null> {
  interface TokenPayload {
    data: {
      id: string
      email: string
    }
  }

  const verify = (token: string, secretKey: string): Promise<TokenPayload> => {
    return new Promise((resolve, reject) => {
      jwt.verify(token, secretKey, (err, decoded) => {
        if (err !== null) {
          reject(err)
        } else {
          resolve(decoded as TokenPayload)
        }
      })
    })
  }

  try {
    const decoded = await verify(token, security.publicKey)
    return await UserModel.findByPk(decoded.data.id)
  } catch (err) {
    logger.error(`Error verifying token: ${err}`)
    return null
  }
}

// Process a chat message via Express API
export function process () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Handle unauthenticated users
      const userId = req.body.userId || 'anonymous'
      const query = req.body.query
      
      if (!query) {
        res.status(400).json({
          error: 'No query provided'
        })
        return
      }

      logger.info(`Processing query: "${query}" for user: ${userId}`)
      
      // Process the chat query
      const response = await chatbot.processChat(userId, query)
      res.status(200).json(response)
    } catch (error) {
      logger.error(`Error in process function: ${error}`)
      next(error)
    }
  }
}

// Function to handle chat messages from authenticated users
export const respond = function respond () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.token || utils.jwtFrom(req)
      if (!token) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const user = await getUserFromJwt(token)
      if (!user) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      // If no query provided, return a greeting
      if (!req.body.query) {
        res.status(200).json({
          action: 'response',
          body: chatbot.getGreeting(user.username)
        })
        return
      }

      logger.info(`Processing authenticated query: "${req.body.query}" for user: ${user.id} (${user.username})`)
      
      // Make sure user ID is properly converted to string
      // This ensures compatibility with the chatbot module's expected string type
      const userId = String(user.id)
      logger.info(`Using userId: ${userId} (converted from ${user.id}, type: ${typeof user.id})`)
      
      const response = await chatbot.processChat(userId, req.body.query, user.username)
      res.status(200).json(response)
    } catch (error) {
      logger.error(`Error in respond function: ${error}`)
      next(error)
    }
  }
}

// Get chatbot status
export const status = function status () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if chatbot is available
      const botStatus = chatbot.getChatbotStatus()
      
      if (!botStatus.available) {
        res.status(200).json({
          status: false,
          body: `${config.get<string>('application.chatBot.name')} isn't ready at the moment, please check the configuration.`
        })
        return
      }
      
      // For unauthenticated users
      const token = req.cookies.token || utils.jwtFrom(req)
      if (!token) {
        res.status(200).json({
          status: true,
          body: `Hi there! I'm ${config.get<string>('application.chatBot.name')}. Sign in to continue our conversation.`
        })
        return
      }

      // For authenticated users
      const user = await getUserFromJwt(token)
      if (!user) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      // Return personalized greeting
      res.status(200).json({
        status: true,
        body: chatbot.getGreeting(user.username)
      })
    } catch (error) {
      logger.error(`Error in status function: ${error}`)
      next(error)
    }
  }
}

// Clear conversation history
export const clearHistory = function clearHistory () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.token || utils.jwtFrom(req)
      if (!token) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const user = await getUserFromJwt(token)
      if (!user) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      // Convert user.id to string for compatibility
      const userId = String(user.id) 
      logger.info(`Clearing chat history for user: ${userId} (${user.username})`)
      
      chatbot.clearConversationHistory(userId)
      
      res.status(200).json({
        status: true,
        body: chatbot.getGreeting(user.username)
      })
    } catch (error) {
      logger.error(`Error in clearHistory function: ${error}`)
      next(error)
    }
  }
}

// Save a chat message
export const saveMessage = function saveMessage () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.token || utils.jwtFrom(req)
      if (!token) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const user = await getUserFromJwt(token)
      if (!user) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const { message, role } = req.body
      if (!message || !role) {
        res.status(400).json({
          error: 'Message and role are required'
        })
        return
      }

      const chatMessage = await ChatModel.create({
        UserId: user.id,
        message,
        role
      })

      res.status(200).json(chatMessage)
    } catch (error) {
      logger.error(`Error in saveMessage function: ${error}`)
      next(error)
    }
  }
}

// Get chat messages for a user
export const getMessages = function getMessages () {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.cookies.token || utils.jwtFrom(req)
      if (!token) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const user = await getUserFromJwt(token)
      if (!user) {
        res.status(401).json({
          error: 'Unauthenticated user'
        })
        return
      }

      const messages = await ChatModel.findAll({
        where: {
          UserId: user.id
        },
        order: [['timestamp', 'ASC']]
      })

      res.status(200).json(messages)
    } catch (error) {
      logger.error(`Error in getMessages function: ${error}`)
      next(error)
    }
  }
}

// Add after other exports
export const executeSQL = function executeSQL () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || ''
    const loggedInUser = security.authenticatedUsers.get(token)
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { sql } = req.body
      if (!sql) {
        res.status(400).json({ error: 'No SQL query provided' })
        return
      }

      // Execute the query
      const [results] = await sequelize.query(sql)
      res.json(results)
    } catch (error) {
      logger.error(`Error executing SQL: ${error}`)
      next(error)
    }
  }
}
