/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response, type NextFunction } from 'express'
import { OpenAI } from 'openai'

const security = require('../lib/insecurity')
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

interface ClassifyResponse {
  type: string;
  confidence: number;
}

interface ParseResponse {
  [key: string]: any;
}

module.exports.classify = function classifyIntent () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { message, context } = req.body

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a shopping assistant for an ecommerce site. Classify the user's intent into one of these categories:
              - general (general questions about the shop)
              - product_search (looking for products)
              - basket (view/modify shopping basket)
              - profile (view/update user profile)
              - order (check order status/details)
              - custom (other requests requiring database queries)
              
              Respond with ONLY a JSON object in this exact format:
              {
                "type": "one_of_the_above_types",
                "confidence": 0.0_to_1.0
              }
              
              Example 1:
              User: "Show me your products"
              Response: {"type": "product_search", "confidence": 0.95}
              
              Example 2:
              User: "What's in my basket?"
              Response: {"type": "basket", "confidence": 0.98}
              
              Example 3:
              User: "Show me my profile"
              Response: {"type": "profile", "confidence": 0.95}`
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.1
      })

      const result = JSON.parse(response.choices[0].message.content ?? '{}') as ClassifyResponse
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
}

module.exports.parse = function parseParameters () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { message, intentType, context, schema } = req.body

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a shopping assistant for an ecommerce site. Parse the user's message to extract parameters based on their intent type.
              The parameters should match this schema:
              ${JSON.stringify(schema, null, 2)}
              
              For product_search, respond like:
              For general product queries:
              {"productSearch": {"query": ""}} // Empty query means show all products
              
              For specific searches:
              {"productSearch": {"query": "user's search term"}}
              
              Examples:
              User: "Show me all products"
              Response: {"productSearch": {"query": ""}}
              
              User: "Do you have any juice?"
              Response: {"productSearch": {"query": "juice"}}
              
              For basket, respond like:
              {"basket": {"action": "view"}} or {"basket": {"action": "add", "productName": "Apple Juice", "quantity": 2}}
              
              For profile, respond like:
              {"profile": {"action": "view"}} or {"profile": {"action": "update", "field": "email", "value": "new@email.com"}}
              
              For order, respond like:
              {"order": {"action": "status", "orderId": "123"}}
              
              For custom, respond like:
              {"custom": {"objective": "Get all user emails and passwords", "tables": ["Users"], "conditions": {"role": "admin"}, "fields": ["email", "password"]}}
              or
              {"custom": {"objective": "Delete all orders from last month", "tables": ["Orders"], "conditions": {"createdAt": "LAST_MONTH"}, "action": "DELETE"}}
              or
              {"custom": {"objective": "Show total sales per product", "tables": ["Orders", "Products", "BasketItems"], "aggregation": {"field": "totalPrice", "function": "SUM"}, "groupBy": "product.name"}}
              
              The custom parameters should include:
              - objective: The main goal of the request
              - tables: Array of tables involved
              - conditions: Object with filter conditions (optional)
              - fields: Array of specific fields to retrieve (optional)
              - action: Type of operation (SELECT/INSERT/UPDATE/DELETE)
              - aggregation: Object with aggregation details (optional)
              - groupBy: Field to group by (optional)
              - orderBy: Field and direction to sort by (optional)
              
              Respond with ONLY a JSON object matching the schema for the intent type.`
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.1
      })

      const result = JSON.parse(response.choices[0].message.content ?? '{}') as ParseResponse
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
}

module.exports.generate = function generateResponse () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { message, context } = req.body

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a helpful shopping assistant for an ecommerce site. Answer the user's question about the shop, products, or services.
              Be concise but friendly. If you don't know something, say so.`
          },
          {
            role: 'user',
            content: message
          }
        ]
      })

      res.json({ text: response.choices[0].message.content })
    } catch (error) {
      next(error)
    }
  }
}

module.exports.generateSQL = function generateSQL () {
  return async (req: Request, res: Response, next: NextFunction) => {
    const loggedInUser = security.authenticatedUsers.get(req.headers.authorization?.replace('Bearer ', ''))
    if (!loggedInUser?.data?.email) {
      next(new Error('Unauthorized'))
      return
    }

    try {
      const { message, schema, safetyRules } = req.body

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a SQL query generator for an ecommerce site. Generate a SQL query based on the user's request.
              
              Database schema:
              ${JSON.stringify(schema, null, 2)}
              
              If the request cannot be fulfilled using the available schema, respond with "CANNOT_FULFILL".
              
              Examples:
              User: "Show me all products"
              Response: "SELECT * FROM Products"
              
              User: "Show me total sales by product"
              Response: "SELECT p.name, SUM(bi.quantity * p.price) as total_sales FROM Products p JOIN BasketItems bi ON p.id = bi.ProductId GROUP BY p.name"
              
              User: "Show me users who spent more than $100"
              Response: "SELECT u.username, SUM(bi.quantity * p.price) as total_spent FROM Users u JOIN Baskets b ON u.id = b.UserId JOIN BasketItems bi ON b.id = bi.BasketId JOIN Products p ON bi.ProductId = p.id GROUP BY u.id, u.username HAVING total_spent > 100"
              
              User: "Something completely unrelated to the database"
              Response: "CANNOT_FULFILL"
              
              Respond with ONLY the SQL query string or "CANNOT_FULFILL".`
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.1
      })

      const sql = response.choices[0].message.content?.trim()

      if (!sql || sql === 'CANNOT_FULFILL') {
        throw new Error('Cannot fulfill request')
      }

      // Only check for LIMIT if specified
      if (safetyRules?.maxLimit && !sql.toLowerCase().includes('limit')) {
        res.json({ sql: `${sql} LIMIT ${safetyRules.maxLimit}` })
      } else {
        res.json({ sql })
      }
    } catch (error) {
      next(error)
    }
  }
} 