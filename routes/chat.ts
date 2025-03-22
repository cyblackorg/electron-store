/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response, type NextFunction } from 'express'
import { ChatModel } from '../models/chat'

const security = require('../lib/insecurity')

module.exports.getMessages = function getMessages () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const messages = await ChatModel.findAll({
        where: {
          UserId: loggedInUser.data.id
        },
        order: [['timestamp', 'ASC']]
      })

      res.json(messages)
    } catch (error) {
      next(error)
    }
  }
}

module.exports.saveMessage = function saveMessage () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { message, role } = req.body
      const chatMessage = await ChatModel.create({
        UserId: loggedInUser.data.id,
        message,
        role
      })

      res.json(chatMessage)
    } catch (error) {
      next(error)
    }
  }
}

module.exports.clearHistory = function clearHistory () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      await ChatModel.destroy({
        where: {
          UserId: loggedInUser.data.id
        }
      })

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  }
} 