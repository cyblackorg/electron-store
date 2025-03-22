/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import config from 'config'
import logger from './logger'
import { ProductModel } from '../models/product'
import { UserModel } from '../models/user'
import { BasketModel } from '../models/basket'
import { BasketItemModel } from '../models/basketitem'
import * as security from './insecurity'
import { sequelize } from '../models'
import { QueryTypes } from 'sequelize'
import { promises as fs } from 'fs'
import axios from 'axios'

// Configure with environment variables or config file
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || config.get('application.chatBot.llmApiKey') || ''
const LLM_API_URL = process.env.LLM_API_URL || config.get('application.chatBot.llmApiUrl') || 'https://api.openai.com/v1/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || config.get('application.chatBot.llmModel') || 'gpt-3.5-turbo'
const LLM_SYSTEM_PROMPT = process.env.LLM_SYSTEM_PROMPT || config.get('application.chatBot.systemPrompt') || 
  `You are ${config.get('application.chatBot.name')}, a helpful assistant for the ${config.get('application.name')}. 
  Your greeting message is: "${config.get('application.chatBot.greeting')}".
  Your default response when unsure is: "${config.get('application.chatBot.defaultResponse')}".
  
  IMPORTANT: Be flexible in recognizing user requests. Understand similar phrasings, variations, and synonyms for all features you support. The examples below are just common patterns - recognize similar questions even if they use different wording.
  
  Recognize and respond to these common customer inquiries:
  - "What products do you have?" or "What do you sell?" - Respond with product information
  - "Tell me about your products" - Explain available product categories
  - "Do you have X?" (where X is a product type) - Check if we have that product type
  - "How much is X?" or "What is the price of X?" - Provide pricing information

  Answer customer questions helpfully and truthfully. When you need to perform actions on behalf of customers, use the available functions.
  You can also execute SQL queries to retrieve data that isn't covered by the existing functions, but be careful to only use SELECT statements and avoid any queries that could modify data.`

// Chat response structure
export interface ChatResponse {
  action: string
  body: string
  data?: any
}

// Conversation history types
interface Message {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  name?: string
}

interface ConversationHistory {
  [userId: string]: Message[]
}

// In-memory conversation history store (could be replaced with Redis or another store)
const conversationHistories: ConversationHistory = {}

// Maximum number of previous messages to retain per user
const MAX_HISTORY_LENGTH = 10

// List of allowed SQL query patterns (only SELECTs and safe operations)
const ALLOWED_SQL_PATTERNS = [
  /^SELECT\s+.*\s+FROM\s+.*$/i,
  /^WITH\s+.*\s+SELECT\s+.*\s+FROM\s+.*$/i
]

// List of disallowed SQL patterns (to prevent unsafe operations)
const DISALLOWED_SQL_PATTERNS = [
  /DROP\s+/i,
  /ALTER\s+/i,
  /CREATE\s+/i,
  /TRUNCATE\s+/i,
  /EXEC\s+/i,
  /UNION\s+/i,
  /BENCHMARK\s*\(/i,
]

// Restricted tables that shouldn't be accessed directly
const RESTRICTED_TABLES = [
  'SecurityAnswers',
]

// Tool definitions for the LLM to use
const botTools = [
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

// Implementation of tool functions
async function executeToolFunction(functionName: string, parameters: any): Promise<any> {
  logger.info(`Executing tool function: ${functionName} with parameters: ${JSON.stringify(parameters)}`)
  try {
    // Special logging for user-related functions
    if (['get_user_information', 'add_to_basket', 'get_basket'].includes(functionName)) {
      logger.info(`User-related function: ${functionName}, userId: ${parameters.userId}, type: ${typeof parameters.userId}`)
    }
    
    let result
    switch (functionName) {
      case 'get_product_information':
        result = await getProductInformation(parameters.query)
        break
      case 'get_user_information':
        result = await getUserInformation(parameters.userId)
        break
      case 'add_to_basket':
        // Ensure productId is a number
        const productId = typeof parameters.productId === 'string'
          ? parseInt(parameters.productId, 10)
          : parameters.productId
        result = await addToBasket(parameters.userId, productId, parameters.quantity)
        break
      case 'get_basket':
        result = await getBasket(parameters.userId)
        // Map new response format to old format for backward compatibility
        if (!result.error && result.products) {
          // Add backward compatibility mapping
          result.items = result.products.map((product: any) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: product.quantity,
            productId: product.id
          }));
        }
        break
      case 'generate_coupon':
        result = await generateCoupon(parameters.discount)
        break
      case 'execute_sql_query':
        result = await executeSqlQuery(parameters.query, parameters.explanation)
        break
      default:
        throw new Error(`Unknown function: ${functionName}`)
    }
    logger.info(`Function ${functionName} executed successfully with result: ${JSON.stringify(result)}`)
    return result
  } catch (error) {
    logger.error(`Error executing function ${functionName}: ${error}`)
    return { error: `Error executing function ${functionName}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function getProductInformation(query: string): Promise<any> {
  try {
    const products = await ProductModel.findAll({
      where: {} // We'll filter in JS to avoid SQL issues
    })
    
    // If query is empty or a general product inquiry, return all products
    const generalQueries = ['products', 'all products', 'what products', 'available', 'merchandise', 'items', 'catalog'];
    const isGeneralQuery = !query || 
                          query.trim() === '' || 
                          generalQueries.some(q => query.toLowerCase().includes(q));
    
    // Filter products based on query (unless it's a general query)
    const filteredProducts = isGeneralQuery 
      ? products 
      : products.filter(product => 
          product.name.toLowerCase().includes(query.toLowerCase()) || 
          (product.description && product.description.toLowerCase().includes(query.toLowerCase()))
        );
    
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
    logger.info(`Adding to basket for userId: ${userId}, productId: ${productId}, quantity: ${quantity}`);
    
    if (!userId) {
      logger.error('No userId provided to addToBasket function');
      return { error: 'User ID is required' };
    }
    
    // Simple user lookup, just check if user exists
    const user = await UserModel.findByPk(userId);
    if (!user) {
      // For numeric IDs, try direct conversion
      const numericUserId = parseInt(userId, 10);
      if (!isNaN(numericUserId)) {
        const numericUser = await UserModel.findByPk(numericUserId);
        if (!numericUser) {
          logger.error(`User not found with ID: ${userId} or numeric equivalent ${numericUserId}`);
          return { error: 'User not found - could not add item to basket' };
        }
      } else {
        logger.error(`User not found with ID: ${userId}`);
        return { error: 'User not found - could not add item to basket' };
      }
    }
    
    // Get or create basket for user
    // Always use numeric ID for basket creation to match the database expectations
    const userIdToUse = user ? (typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10)) : parseInt(userId, 10);
    
    logger.info(`Looking for basket with UserId: ${userIdToUse}`);
    let basket = await BasketModel.findOne({ where: { UserId: userIdToUse } });
    
    if (!basket) {
      logger.info(`Creating new basket for UserId: ${userIdToUse}`);
      try {
        basket = await BasketModel.create({ UserId: userIdToUse });
        logger.info(`Created new basket with ID ${basket.id}`);
      } catch (basketError) {
        logger.error(`Failed to create basket: ${basketError}`);
        return { error: 'Could not create basket' };
      }
    }
    
    // Find product
    const product = await ProductModel.findByPk(productId);
    if (!product) {
      logger.error(`Product not found with ID: ${productId}`);
      return { error: 'Product not found' };
    }
    
    // Check if product already in basket
    let basketItem = await BasketItemModel.findOne({
      where: {
        BasketId: basket.id,
        ProductId: productId
      }
    });
    
    if (basketItem) {
      // Update quantity if already exists
      const newQuantity = basketItem.quantity + quantity;
      await basketItem.update({ quantity: newQuantity });
      logger.info(`Updated quantity of ${product.name} to ${newQuantity}`);
    } else {
      // Add new basket item
      basketItem = await BasketItemModel.create({
        BasketId: basket.id,
        ProductId: productId,
        quantity: quantity
      });
      logger.info(`Added new item to basket: ${product.name}, quantity: ${quantity}`);
    }
    
    return {
      success: true,
      message: `Added ${quantity} x ${product.name} to basket`,
      basketId: basket.id
    };
  } catch (error) {
    logger.error(`Error adding to basket: ${error}`);
    return { 
      error: 'Failed to add product to basket: ' + (error instanceof Error ? error.message : String(error)),
      success: false
    };
  }
}

async function getBasket(userId: string): Promise<any> {
  try {
    logger.info(`Getting basket for userId: ${userId}`);
    
    if (!userId) {
      logger.error('No userId provided to getBasket function');
      return { error: 'User ID is required' };
    }
    
    // Try to find user - check both string and numeric IDs
    const user = await UserModel.findByPk(userId);
    
    // If not found with string ID, try numeric
    if (!user && !isNaN(parseInt(userId, 10))) {
      const numericUserId = parseInt(userId, 10);
      logger.info(`User not found with string ID, trying numeric ID: ${numericUserId}`);
      const numericUser = await UserModel.findByPk(numericUserId);
      
      if (!numericUser) {
        logger.error(`User not found with ID: ${userId} or numeric equivalent ${numericUserId}`);
        return { error: 'User not found - could not retrieve basket' };
      }
      
      // Continue with numeric ID if found
      const userIdToUse = numericUserId;
      logger.info(`Found user with numeric ID: ${userIdToUse}`);
      
      // Get basket for this user
      const basket = await BasketModel.findOne({
        where: { UserId: userIdToUse },
        include: [{
          model: ProductModel,
          as: 'Products',
          through: { attributes: ['quantity'] }
        }]
      });
      
      if (!basket) {
        logger.info(`No basket found for user ID: ${userIdToUse}`);
        return { 
          id: null, 
          products: [], 
          empty: true, 
          message: 'Your basket is empty' 
        };
      }
      
      logger.info(`Found basket with ID: ${basket.id} for user ID: ${userIdToUse}`);
      
      // Format basket products
      const products = (basket.Products || []).map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        quantity: product.BasketItem?.quantity || 1
      }));
      
      return {
        id: basket.id,
        products: products,
        empty: products.length === 0,
        message: products.length > 0 ? `Your basket has ${products.length} product(s)` : 'Your basket is empty'
      };
    } else if (user) {
      // Found user with original ID
      const userIdToUse = typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10);
      logger.info(`Found user with ID: ${userIdToUse}`);
      
      // Get basket for this user
      const basket = await BasketModel.findOne({
        where: { UserId: userIdToUse },
        include: [{
          model: ProductModel,
          as: 'Products',
          through: { attributes: ['quantity'] }
        }]
      });
      
      if (!basket) {
        logger.info(`No basket found for user ID: ${userIdToUse}`);
        return { 
          id: null, 
          products: [], 
          empty: true, 
          message: 'Your basket is empty' 
        };
      }
      
      logger.info(`Found basket with ID: ${basket.id} for user ID: ${userIdToUse}`);
      
      // Format basket products
      const products = (basket.Products || []).map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        quantity: product.BasketItem?.quantity || 1
      }));
      
      return {
        id: basket.id,
        products: products,
        empty: products.length === 0,
        message: products.length > 0 ? `Your basket has ${products.length} product(s)` : 'Your basket is empty'
      };
    } else {
      logger.error(`User not found with ID: ${userId}`);
      return { error: 'User not found - could not retrieve basket' };
    }
  } catch (error) {
    logger.error(`Error getting basket: ${error}`);
    return { 
      error: 'Failed to retrieve basket: ' + (error instanceof Error ? error.message : String(error)),
      success: false
    };
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

/**
 * Adds a message to the user's conversation history
 */
function addToConversationHistory(userId: string, message: Message): void {
  if (!conversationHistories[userId]) {
    conversationHistories[userId] = [
      { role: 'system', content: LLM_SYSTEM_PROMPT }
    ]
  }
  
  conversationHistories[userId].push(message)
  
  // Keep history within size limits
  if (conversationHistories[userId].length > MAX_HISTORY_LENGTH + 1) { // +1 for system message
    // Keep system message and remove oldest user/assistant messages
    const systemMessage = conversationHistories[userId][0]
    conversationHistories[userId] = [
      systemMessage,
      ...conversationHistories[userId].slice(conversationHistories[userId].length - MAX_HISTORY_LENGTH)
    ]
  }
}

/**
 * Gets the conversation history for a user
 */
function getConversationHistory(userId: string): Message[] {
  if (!conversationHistories[userId]) {
    conversationHistories[userId] = [
      { role: 'system', content: LLM_SYSTEM_PROMPT }
    ]
  }
  return conversationHistories[userId]
}

/**
 * Clear a user's conversation history
 */
export function clearConversationHistory(userId: string): void {
  if (conversationHistories[userId]) {
    // Keep only the system message
    const systemMessage = conversationHistories[userId][0]
    conversationHistories[userId] = [systemMessage]
  }
}

/**
 * Process a chat query and generate a response
 */
export async function processChat(userId: string, query: string, username?: string): Promise<ChatResponse> {
  try {
    // Log user details for debugging
    logger.info(`processChat called with userId: ${userId}, type: ${typeof userId}, username: ${username || 'not provided'}`)
    
    if (!LLM_API_KEY) {
      logger.warn('LLM API key not configured')
      return {
        action: 'response',
        body: 'Sorry, I\'m not properly configured at the moment. Please try again later or contact support.'
      }
    }

    // Detect if this is a product inquiry query
    const productRelatedTerms = ['product', 'item', 'sell', 'price', 'cost', 'available', 'stock', 'what do you have', 'what do you sell', 'merchandise', 'catalog'];
    const isProductQuery = productRelatedTerms.some(term => query.toLowerCase().includes(term));
    
    // For simple product inquiries, process them directly
    if (isProductQuery) {
      logger.info(`Detected product query: "${query}" - handling directly`);
      try {
        const functionResult = await getProductInformation(query);
        
        // If we found products, generate a response about them
        if (functionResult.products && functionResult.products.length > 0) {
          // Format product list for better readability
          const productList = functionResult.products
            .slice(0, 5) // Limit to 5 products for readability
            .map((p: any) => `${p.name} - $${p.price}`)
            .join('\n');
          
          const totalProducts = functionResult.products.length;
          const response = totalProducts > 5 
            ? `Here are some of our products:\n\n${productList}\n\n...and ${totalProducts - 5} more. Would you like more details about any specific product?`
            : `Here are our products:\n\n${productList}\n\nWould you like more details about any of these?`;
            
          // Add this interaction to history
          addToConversationHistory(userId, {
            role: 'user',
            content: query
          });
          addToConversationHistory(userId, {
            role: 'assistant',
            content: response
          });
            
          return {
            action: 'response',
            body: response,
            data: functionResult
          };
        }
      } catch (error) {
        logger.error(`Error handling product query directly: ${error}`);
        // Continue with normal LLM processing if direct handling fails
      }
    }

    // Add username to system prompt if provided
    let history = getConversationHistory(userId)
    
    // If this is a new conversation and we have a username, customize the first system prompt
    if (username && history.length === 1) {
      history[0].content = history[0].content.replace('<customer-name>', username)
    }
    
    // Add user message to history
    addToConversationHistory(userId, {
      role: 'user',
      content: query
    })
    
    // Update history after adding the new message
    history = getConversationHistory(userId)
    
    logger.debug(`Sending query to LLM for user ${userId}: ${query}`)
    logger.debug(`Conversation history length: ${history.length}`)

    // Call LLM API
    let response
    try {
      logger.info(`Sending request to LLM API at ${LLM_API_URL} with model ${LLM_MODEL}`)
      response = await axios.post(
        LLM_API_URL,
        {
          model: LLM_MODEL,
          messages: history,
          tools: botTools,
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
      logger.info(`Received response from LLM API: status ${response.status}`)
    } catch (error) {
      const apiError = error as any // Type assertion for error handling
      logger.error(`LLM API error: ${apiError}`)
      logger.error(`Response data: ${apiError.response?.data ? JSON.stringify(apiError.response.data) : 'No response data'}`)
      return {
        action: 'response',
        body: 'Sorry, there was an error communicating with the AI service. Please try again later.'
      }
    }

    const assistantMessage = response.data.choices[0].message
    
    // Add assistant message to history
    addToConversationHistory(userId, {
      role: 'assistant',
      content: assistantMessage.content || '',
      name: assistantMessage.name
    })

    // Check if the LLM wants to call a function
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      logger.info(`LLM requested tool calls: ${JSON.stringify(assistantMessage.tool_calls)}`)
      const toolCall = assistantMessage.tool_calls[0]
      const functionName = toolCall.function.name
      
      // Log the actual arguments received
      logger.info(`Function arguments (raw): ${toolCall.function.arguments}`)
      
      let parameters
      try {
        parameters = JSON.parse(toolCall.function.arguments)
        logger.info(`Parsed parameters: ${JSON.stringify(parameters)}`)
      } catch (parseError) {
        logger.error(`Error parsing function arguments: ${parseError}`)
        return {
          action: 'response',
          body: 'I encountered an error while processing your request. Please try a different query.'
        }
      }
      
      // IMPORTANT: Ensure userId is always included for user-related functions
      if (['get_user_information', 'add_to_basket', 'get_basket'].includes(functionName)) {
        // Always override with the authenticated userId from the request
        parameters.userId = userId
        logger.info(`Ensuring userId is set correctly: ${userId} (type: ${typeof userId})`)
      }
      
      logger.info(`LLM executing function: ${functionName} with final parameters: ${JSON.stringify(parameters)}`)
      
      // Execute the function
      const functionResult = await executeToolFunction(functionName, parameters)
      logger.info(`Function result: ${JSON.stringify(functionResult)}`)
      
      // Handle specific errors for basket operations
      if (functionName === 'add_to_basket') {
        if (functionResult.error) {
          // Item failed to be added to the basket
          logger.error(`Error adding to basket: ${functionResult.error}`);
          return {
            action: 'response',
            body: `I couldn't add that item to your basket: ${functionResult.error}. Please try again or contact customer support if the problem persists.`,
            data: functionResult
          };
        } else if (functionResult.success) {
          // Item was successfully added
          logger.info(`Successfully added item to basket: ${functionResult.message}`);
          
          // Try to verify the basket content immediately to diagnose any issues
          try {
            const basketCheck = await getBasket(userId);
            if (basketCheck.error) {
              logger.error(`Error verifying basket after adding item: ${basketCheck.error}`);
              return {
                action: 'response',
                body: `${functionResult.message}. However, I had trouble verifying your basket contents: ${basketCheck.error}`,
                data: functionResult
              };
            }
            
            if (!basketCheck.empty && basketCheck.products && basketCheck.products.length > 0) {
              // Everything is working correctly
              return {
                action: 'response',
                body: `${functionResult.message}. Your basket now contains ${basketCheck.products.length} item(s).`,
                data: {
                  ...functionResult,
                  basketContents: basketCheck.products
                }
              };
            } else {
              // Item was added but can't be seen in the basket - something is wrong
              logger.warn(`Item was added to basket but can't be seen in subsequent basket check`);
              return {
                action: 'response',
                body: `${functionResult.message}. However, I'm having trouble displaying your basket contents. The item was added, but you may need to refresh your page to see it.`,
                data: {
                  ...functionResult,
                  basketCheckFailed: true
                }
              };
            }
          } catch (basketCheckError) {
            logger.error(`Error checking basket after adding item: ${basketCheckError}`);
            return {
              action: 'response',
              body: `${functionResult.message}. The item was added successfully, but I couldn't retrieve your current basket contents.`,
              data: functionResult
            };
          }
        }
      }
      
      if (functionName === 'get_basket') {
        if (functionResult.error) {
          // Error getting basket
          logger.error(`Error getting basket: ${functionResult.error}`);
          return {
            action: 'response',
            body: `I had trouble retrieving your basket: ${functionResult.error}. Please try refreshing your page or contact customer support.`,
            data: functionResult
          };
        } else if (functionResult.empty || (functionResult.products && functionResult.products.length === 0)) {
          // Basket is empty
          logger.info(`Retrieved empty basket for user ${userId}`);
          return {
            action: 'response',
            body: `Your basket is currently empty. Would you like me to help you find some products to add?`,
            data: functionResult
          };
        }
        // Normal basket retrieval with items will be handled by the default flow
      }
      
      // If there was an error finding the user, give a more specific response
      if (functionResult.error && functionResult.error.includes('User not found')) {
        logger.error(`User not found error for userId: ${userId}`);
        return {
          action: 'response',
          body: `I couldn't access your user information. This might be due to a session issue. Please try logging out and back in, or contact customer support if the problem persists.`
        };
      }
      
      // Add function response to history
      addToConversationHistory(userId, {
        role: 'function',
        name: functionName,
        content: JSON.stringify(functionResult)
      })
      
      // If SQL query failed, provide more context
      let functionContextMessage = ""
      if (functionName === 'execute_sql_query' && functionResult.error) {
        functionContextMessage = `
When using SQL queries, remember:
- Sensitive tables like SecurityAnswers, are restricted
- Queries are limited to return at most 100 rows
- Keep queries simple and avoid complex operations
`
      }
      
      // Call LLM again to interpret the function result
      const followUpMessages = [...getConversationHistory(userId)]
      
      // Add context message if needed
      if (functionContextMessage) {
        followUpMessages.push({
          role: 'system',
          content: functionContextMessage
        })
      }
      
      let followUpResponse
      try {
        logger.info(`Sending follow-up request to LLM with conversation history length: ${followUpMessages.length}`)
        followUpResponse = await axios.post(
          LLM_API_URL,
          {
            model: LLM_MODEL,
            messages: followUpMessages,
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
        logger.info(`Received follow-up response from LLM API: status ${followUpResponse.status}`)
      } catch (error) {
        const apiError = error as any
        logger.error(`LLM API follow-up error: ${apiError}`)
        logger.error(`Response data: ${apiError.response?.data ? JSON.stringify(apiError.response.data) : 'No response data'}`)
        return {
          action: 'response',
          body: 'I encountered an error while processing your request results. Please try again later.'
        }
      }
      
      const finalMessage = followUpResponse.data.choices[0].message.content
      
      // Add final assistant message to history
      addToConversationHistory(userId, {
        role: 'assistant',
        content: finalMessage
      })
      
      return {
        action: 'response',
        body: finalMessage,
        data: functionResult
      }
    } else {
      // Just a regular response
      logger.info(`Regular conversation response (no tool call) for userId: ${userId}, query: "${query}"`)
      logger.info(`LLM response: "${assistantMessage.content}"`)
      return {
        action: 'response',
        body: assistantMessage.content
      }
    }
  } catch (error) {
    logger.error(`Error in chatbot: ${error}`)
    return {
      action: 'response',
      body: 'Sorry, I encountered an error while processing your request. Please try again later.'
    }
  }
}

/**
 * Get a greeting message for a user
 */
export function getGreeting(username?: string): string {
  let greeting = config.get<string>('application.chatBot.greeting')
  
  // Replace placeholders in greeting
  greeting = greeting.replace('<bot-name>', config.get<string>('application.chatBot.name'))
  
  if (username) {
    greeting = greeting.replace('<customer-name>', username)
  } else {
    // If no username, replace with generic term
    greeting = greeting.replace('<customer-name>', 'there')
  }
  
  return greeting
}

/**
 * Check if the chatbot is available
 */
export function isChatbotAvailable(): boolean {
  return Boolean(LLM_API_KEY)
}

/**
 * Get status information about the chatbot
 */
export function getChatbotStatus(): any {
  return {
    available: isChatbotAvailable(),
    name: config.get<string>('application.chatBot.name'),
    model: LLM_MODEL,
    configured: Boolean(LLM_API_KEY)
  }
}

/**
 * Verifies the basket functionality by checking if required database tables exist
 */
async function verifyBasketFunctionality(): Promise<boolean> {
  try {
    logger.info('Running basket functionality verification...');
    
    // Check if required tables exist
    const tableResults = await sequelize.query(
      "SELECT name FROM sqlite_master WHERE type='table'",
      { type: QueryTypes.SELECT }
    );
    
    // Convert results to array of table names
    const tables = tableResults.map((result: any) => result.name);
    logger.info(`Database tables found: ${tables.join(', ')}`);
    
    // Check for required tables
    const requiredTables = ['Products', 'Baskets', 'BasketItems', 'Users'];
    const missingTables = requiredTables.filter(table => !tables.includes(table));
    
    if (missingTables.length > 0) {
      logger.warn(`Missing required tables: ${missingTables.join(', ')}`);
      return false;
    }
    
    logger.info('All required tables for basket functionality exist');
    return true;
  } catch (error) {
    logger.error(`Error verifying basket functionality: ${error}`);
    return false;
  }
}

// Run verification on module load
verifyBasketFunctionality().then(success => {
  if (success) {
    logger.info('Basket functionality verification completed successfully');
  } else {
    logger.warn('Basket functionality verification failed - some features may not work correctly');
  }
}).catch(error => {
  logger.error(`Error during basket functionality verification: ${error}`);
});