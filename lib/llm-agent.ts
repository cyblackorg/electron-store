/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

// Import axios as a dynamic import to avoid linter error
import config from 'config'
import logger from './logger'
import { ProductModel } from '../models/product'
import { UserModel } from '../models/user'
import { BasketModel } from '../models/basket'
import { BasketItemModel } from '../models/basketitem'
import * as security from './insecurity'
import { type Op } from 'sequelize'
import { type Product } from '../data/types'
import { sequelize } from '../models'
import { QueryTypes } from 'sequelize'

// We need to use dynamic import for axios as it's not part of the project dependencies yet
const axios = require('axios')

// Configure with environment variables or config file
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || config.get('application.llmAgent.apiKey') || ''
const LLM_API_URL = process.env.LLM_API_URL || config.get('application.llmAgent.apiUrl') || 'https://api.openai.com/v1/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || config.get('application.llmAgent.model') || 'gpt-3.5-turbo'
const LLM_SYSTEM_PROMPT = process.env.LLM_SYSTEM_PROMPT || config.get('application.llmAgent.systemPrompt') || 
  'You are a helpful assistant for the Electron Store, an online store selling electronics and tech merchandise. Answer customer questions helpfully and truthfully. When you need to perform actions on behalf of customers, use the available functions. You can also execute SQL queries to retrieve data that isn\'t covered by the existing functions, but be careful to only use SELECT statements and avoid any queries that could modify data.'

// Agent actions
interface AgentAction {
  name: string
  parameters: Record<string, any>
}

// Agent's response structure
interface AgentResponse {
  action: string
  body: string
  data?: any
}

// List of allowed SQL query patterns (only SELECTs and safe operations)
const ALLOWED_SQL_PATTERNS = [
  /^SELECT\s+.*\s+FROM\s+.*$/i,
  /^WITH\s+.*\s+SELECT\s+.*\s+FROM\s+.*$/i
]

// List of disallowed SQL patterns (to prevent unsafe operations)
const DISALLOWED_SQL_PATTERNS = [
  /INSERT\s+INTO/i,
  /UPDATE\s+/i,
  /DELETE\s+FROM/i,
  /DROP\s+/i,
  /ALTER\s+/i,
  /CREATE\s+/i,
  /TRUNCATE\s+/i,
  /EXEC\s+/i,
  /EXECUTE\s+/i,
  /UNION\s+/i,
  /SLEEP\s*\(/i,
  /BENCHMARK\s*\(/i,
  /WAITFOR\s+DELAY/i
]

// Restricted tables that shouldn't be accessed directly
const RESTRICTED_TABLES = [
  'Users',
  'SecurityAnswers',
  'SecurityQuestions',
  'Feedbacks',
  'Complaints',
  'Recycles',
  'Captchas',
  'PrivacyRequests'
]

// Tool definitions for the LLM to use
const agentTools = [
  {
    type: 'function',
    function: {
      name: 'get_product_information',
      description: 'Get information about products available in the shop',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to find products'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_user_information',
      description: 'Get information about the current user',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'ID of the user'
          }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_to_basket',
      description: 'Add a product to the user\'s basket',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'ID of the user'
          },
          productId: {
            type: 'number',
            description: 'ID of the product to add'
          },
          quantity: {
            type: 'number',
            description: 'Quantity of the product to add'
          }
        },
        required: ['userId', 'productId', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_basket',
      description: 'Get the contents of the user\'s basket',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'ID of the user'
          }
        },
        required: ['userId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_coupon',
      description: 'Generate a coupon code for the user',
      parameters: {
        type: 'object',
        properties: {
          discount: {
            type: 'number',
            description: 'Discount percentage (between 10 and 20)'
          }
        },
        required: ['discount']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_sql_query',
      description: 'Execute a SQL query to retrieve data from the database. Only use this for read operations that aren\'t covered by other functions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL query to execute (must be SELECT only)'
          },
          explanation: {
            type: 'string',
            description: 'Brief explanation of what this query is intended to do'
          }
        },
        required: ['query', 'explanation']
      }
    }
  }
]

// Implementation of agent functions
async function executeAgentFunction(functionName: string, parameters: any): Promise<any> {
  switch (functionName) {
    case 'get_product_information':
      return getProductInformation(parameters.query)
    case 'get_user_information':
      return getUserInformation(parameters.userId)
    case 'add_to_basket':
      // Ensure productId is a number
      const productId = typeof parameters.productId === 'string'
        ? parseInt(parameters.productId, 10)
        : parameters.productId
      return addToBasket(parameters.userId, productId, parameters.quantity)
    case 'get_basket':
      return getBasket(parameters.userId)
    case 'generate_coupon':
      return generateCoupon(parameters.discount)
    case 'execute_sql_query':
      return executeSqlQuery(parameters.query, parameters.explanation)
    default:
      throw new Error(`Unknown function: ${functionName}`)
  }
}

async function getProductInformation(query: string): Promise<any> {
  try {
    const products = await ProductModel.findAll({
      where: {} // We'll filter in JS to avoid SQL issues
    }) as unknown as Product[]
    
    // Filter products based on query
    const filteredProducts = products.filter(product => 
      product.name.toLowerCase().includes(query.toLowerCase()) || 
      (product.description && product.description.toLowerCase().includes(query.toLowerCase()))
    )
    
    return {
      products: filteredProducts.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        image: p.image
      }))
    }
  } catch (error) {
    logger.error(`Error getting product information: ${error}`)
    return { error: 'Failed to get product information' }
  }
}

async function getUserInformation(userId: string): Promise<any> {
  try {
    const user = await UserModel.findByPk(userId)
    if (!user) {
      return { error: 'User not found' }
    }
    
    return {
      id: user.id,
      email: user.email,
      username: user.username
    }
  } catch (error) {
    logger.error(`Error getting user information: ${error}`)
    return { error: 'Failed to get user information' }
  }
}

async function addToBasket(userId: string, productId: number, quantity: number): Promise<any> {
  try {
    // Find user's basket
    const user = await UserModel.findByPk(userId)
    if (!user) {
      return { error: 'User not found' }
    }
    
    let basket = await BasketModel.findOne({ where: { UserId: userId } })
    
    // Create basket if it doesn't exist
    if (!basket) {
      // Convert userId to number if it's a string to satisfy type requirements
      const userIdNum = typeof userId === 'string' ? parseInt(userId, 10) : userId
      basket = await BasketModel.create({ UserId: userIdNum })
    }
    
    // Check if product exists
    const product = await ProductModel.findByPk(productId)
    if (!product) {
      return { error: 'Product not found' }
    }
    
    // Check if item is already in basket
    let basketItem = await BasketItemModel.findOne({
      where: {
        BasketId: basket.id,
        ProductId: productId
      }
    })
    
    if (basketItem) {
      // Update quantity if already in basket
      await basketItem.update({ quantity: basketItem.quantity + quantity })
    } else {
      // Add new item to basket
      await BasketItemModel.create({
        BasketId: basket.id,
        ProductId: productId,
        quantity: quantity
      })
    }
    
    return {
      success: true,
      message: `Added ${quantity} x ${product.name} to basket`
    }
  } catch (error) {
    logger.error(`Error adding to basket: ${error}`)
    return { error: 'Failed to add product to basket' }
  }
}

async function getBasket(userId: string): Promise<any> {
  try {
    const basket = await BasketModel.findOne({
      where: { UserId: userId },
      include: [{
        model: BasketItemModel,
        as: 'Products',
        include: [{
          model: ProductModel,
          as: 'product'
        }]
      }]
    })
    
    if (!basket || !basket.Products) {
      return { items: [] }
    }
    
    const items = basket.Products.map((item: any) => ({
      id: item.id,
      name: item.product?.name,
      price: item.product?.price,
      quantity: item.quantity
    }))
    
    return { items }
  } catch (error) {
    logger.error(`Error getting basket: ${error}`)
    return { error: 'Failed to get basket' }
  }
}

function generateCoupon(discount: number): any {
  try {
    // Limit discount range for security
    const safeDiscount = Math.min(Math.max(discount, 10), 20)
    const couponCode = security.generateCoupon(safeDiscount)
    
    return {
      couponCode,
      discount: safeDiscount
    }
  } catch (error) {
    logger.error(`Error generating coupon: ${error}`)
    return { error: 'Failed to generate coupon' }
  }
}

/**
 * Safely executes a SQL query after validating it for security
 */
async function executeSqlQuery(query: string, explanation: string): Promise<any> {
  try {
    // Check if query is allowed
    if (!isQueryAllowed(query)) {
      return { 
        error: 'This query cannot be executed for security reasons. Only SELECT queries on non-sensitive tables are allowed.',
        explanation
      }
    }

    // Execute the query (with safety limits)
    const results = await sequelize.query(
      // Add LIMIT to prevent excessive data retrieval
      query.includes('LIMIT') ? query : `${query} LIMIT 100`,
      {
        type: QueryTypes.SELECT,
        raw: true,
        nest: true,
      }
    )

    return {
      results,
      explanation,
      rowCount: results.length
    }
  } catch (error) {
    logger.error(`Error executing SQL query: ${error}`)
    return { 
      error: `Failed to execute SQL query: ${error instanceof Error ? error.message : String(error)}`,
      explanation
    }
  }
}

/**
 * Checks if a SQL query is allowed by security rules
 */
function isQueryAllowed(query: string): boolean {
  // Check if query matches any allowed pattern
  const isAllowedPattern = ALLOWED_SQL_PATTERNS.some(pattern => pattern.test(query))
  if (!isAllowedPattern) {
    return false
  }

  // Check if query contains any disallowed patterns
  const hasDisallowedPattern = DISALLOWED_SQL_PATTERNS.some(pattern => pattern.test(query))
  if (hasDisallowedPattern) {
    return false
  }

  // Check for access to restricted tables
  const hasRestrictedTable = RESTRICTED_TABLES.some(table => 
    new RegExp(`\\bFROM\\s+${table}\\b`, 'i').test(query) || 
    new RegExp(`\\bJOIN\\s+${table}\\b`, 'i').test(query)
  )
  if (hasRestrictedTable) {
    return false
  }

  return true
}

export async function processQuery(userId: string, query: string): Promise<AgentResponse> {
  try {
    if (!LLM_API_KEY) {
      logger.warn('LLM API key not configured')
      return {
        action: 'response',
        body: 'Sorry, I\'m not properly configured at the moment. Please try again later or contact support.'
      }
    }

    // Prepare conversation history
    const messages = [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: query }
    ]

    // Call LLM API
    const response = await axios.post(
      LLM_API_URL,
      {
        model: LLM_MODEL,
        messages,
        tools: agentTools,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LLM_API_KEY}`
        }
      }
    )

    const assistantMessage = response.data.choices[0].message

    // Check if the LLM wants to call a function
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0]
      const functionName = toolCall.function.name
      const parameters = JSON.parse(toolCall.function.arguments)
      
      // Add userId to parameters if required but not provided
      if (['get_user_information', 'add_to_basket', 'get_basket'].includes(functionName) && !parameters.userId) {
        parameters.userId = userId
      }
      
      // Execute the function
      const functionResult = await executeAgentFunction(functionName, parameters)
      
      // If SQL query failed, provide more context
      let functionContextMessage = ""
      if (functionName === 'execute_sql_query' && functionResult.error) {
        functionContextMessage = `
When using SQL queries, remember:
- Only SELECT queries are allowed
- Sensitive tables like Users, SecurityAnswers, etc. are restricted
- Queries are limited to return at most 100 rows
- Keep queries simple and avoid complex operations
`
      }
      
      // Call LLM again to interpret the function result
      const followUpResponse = await axios.post(
        LLM_API_URL,
        {
          model: LLM_MODEL,
          messages: [
            ...messages,
            assistantMessage,
            {
              role: 'function',
              name: functionName,
              content: JSON.stringify(functionResult)
            },
            ...(functionContextMessage ? [{
              role: 'system',
              content: functionContextMessage
            }] : [])
          ],
          temperature: 0.7,
          max_tokens: 500
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LLM_API_KEY}`
          }
        }
      )
      
      const finalMessage = followUpResponse.data.choices[0].message.content
      
      return {
        action: 'response',
        body: finalMessage,
        data: functionResult
      }
    } else {
      // Just a regular response
      return {
        action: 'response',
        body: assistantMessage.content
      }
    }
  } catch (error) {
    logger.error(`Error in LLM Agent: ${error}`)
    return {
      action: 'response',
      body: 'Sorry, I encountered an error while processing your request. Please try again later.'
    }
  }
} 