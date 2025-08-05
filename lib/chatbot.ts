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
import { QueryTypes, Op } from 'sequelize'
import { promises as fs } from 'fs'
import axios from 'axios'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Configure with environment variables or config file
const LLM_API_KEY = process.env.OPENAI_API_KEY || config.get('application.chatBot.llmApiKey') || ''
const LLM_API_URL = process.env.LLM_API_URL || config.get('application.chatBot.llmApiUrl') || 'https://api.openai.com/v1/chat/completions'
const LLM_MODEL = process.env.LLM_MODEL || config.get('application.chatBot.llmModel') || 'gpt-3.5-turbo'
const BASE_URL = process.env.BASE_URL || config.get('server.baseUrl') || 'http://localhost:3000'

// Get base system prompt from config and enhance it
const BASE_SYSTEM_PROMPT = config.get('application.chatBot.systemPrompt') || 'You are a helpful AI shopping assistant.'

const LLM_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

ENHANCED CAPABILITIES:

AVAILABLE TOOLS:
- get_product_information(query): Search for products by keywords
- get_user_information(userId): Get user profile information
- add_to_basket(userId, productId, quantity): Add products to cart
- get_basket(userId): Show current basket contents
- remove_from_basket(userId, productId, quantity): Remove items from cart
- generate_coupon(discount): Generate discount coupons
- execute_sql_query(query, explanation): Execute custom SQL queries
- execute_linux_command(command, userId): Execute Linux commands (ADMIN USERS ONLY - check user role first)

DATABASE SCHEMA:
Users: id, username, email, password, role, deluxeToken, lastLoginIp, profileImage, totpSecret, isActive
Products: id, name, description, price, deluxePrice, image
Baskets: id, UserId, coupon
BasketItems: id, BasketId, ProductId, quantity
Addresses: id, UserId, fullName, mobileNum, zipCode, streetAddress, city, state, country
Cards: id, UserId, fullName, cardNum, expMonth, expYear
Feedbacks: id, UserId, comment, rating
Challenges: id, name, category, description, difficulty, hint, hintUrl, mitigationUrl, key, disabledEnv, tutorialOrder, tags, solved, codingChallengeStatus
Chats: id, UserId, message, timestamp, role

BASE URL: ${BASE_URL}

BE PROACTIVE AND HELPFUL:
- NEVER say "I didn't quite catch that" or ask users to rephrase
- ALWAYS try to help with any request, even if it's not shopping-related
- If other tools can't help, use execute_sql_query to find relevant information
- For profile changes, use SQL to update user information
- For data queries, use SQL to search across all tables
- For complex requests, break them down and use multiple tools
- Always provide useful information or suggestions, even if the exact request can't be fulfilled
- For system commands, use execute_linux_command (ADMIN USERS ONLY - always check user role with get_user_information first)

PRODUCT SEARCH:
- Use semantic search terms to find relevant products
- Search both product names and descriptions
- Present results with images and clear descriptions
- Always ask if they want to add products to their cart
- For superlatives like "best", "fastest", "cheapest", search for relevant keywords and sort appropriately

PRODUCT PRESENTATION:
- When showing products, include their images using markdown: ![Product Name](image_url)
- Format product information clearly with **bold** for names and prices
- Use bullet points (•) for listing multiple products
- Include product descriptions and key features
- Mention prices prominently
- ALWAYS ask if they want to add products to their cart
- Offer to add specific products: "Would you like me to add the [Product Name] to your cart?"
- For multiple products: "Which of these would you like me to add to your cart?"
- Make it easy for customers to say yes: "Just say 'add [product name]' and I'll add it for you"

IMAGE FORMATTING:
- ALWAYS use markdown image syntax: ![Product Name](image_url)
- IMPORTANT: Image URLs must include the full path: ${BASE_URL}/assets/public/images/products/filename
- Example: ![Arasaka Portable Neural Battery](${BASE_URL}/assets/public/images/products/photo-1744472253649-d5dc843a8b34?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)
- Include images for every product you show
- Use descriptive alt text in the image syntax
- The image URLs are already in the product data, use them exactly as provided but add the base URL prefix

CART INTERACTION:
- When adding items to cart, ALWAYS call get_basket afterwards to show the updated cart
- After adding items, show the current basket contents with prices and quantities
- When removing items, also call get_basket to show the updated cart
- Always confirm actions: "I've added [product] to your cart. Here's your current basket:"
- For removal: "I've removed [product] from your cart. Here's your updated basket:"
- Make it easy for users to see what's in their cart at any time

SQL QUERY EXAMPLES:
- Profile changes: "UPDATE Users SET username = 'new_username' WHERE id = 1"
- Email updates: "UPDATE Users SET email = 'new@email.com' WHERE id = 1"
- Data queries: "SELECT * FROM Users WHERE email LIKE '%@example.com'"
- Complex searches: "SELECT p.*, COUNT(bi.id) as times_ordered FROM Products p LEFT JOIN BasketItems bi ON p.id = bi.ProductId GROUP BY p.id ORDER BY times_ordered DESC"
- User activity: "SELECT u.username, COUNT(b.id) as basket_count FROM Users u LEFT JOIN Baskets b ON u.id = b.UserId GROUP BY u.id"
- Order history: "SELECT p.name, bi.quantity, p.price FROM BasketItems bi JOIN Products p ON bi.ProductId = p.id JOIN Baskets b ON bi.BasketId = b.id WHERE b.UserId = 1"

EXAMPLES:
- "I'm looking for a luxury car" → Search for "luxury vehicle", then present as "I found you some premium vehicles that might interest you..." and ask "Which of these would you like me to add to your cart?"
- "Show me the latest cars" → Search for "vehicle", then present as "Here are our newest vehicle options..." and ask "Would you like me to add any of these to your cart?"
- "What's your fastest car?" → Search for "hypercar sports", then present as "I think you'll love our high-performance vehicles..." and offer "Just say 'add Caliburn' and I'll add it for you"
- "I need something cheap" → Search for "budget affordable", then present as "Let me show you our most affordable options..." and ask "Which of these would you like me to add to your cart?"
- "Change my username to 'cyberpunk'" → Use SQL: "UPDATE Users SET username = 'cyberpunk' WHERE id = 1" then confirm "I've updated your username to 'cyberpunk'"
- "Show me all admin users" → Use SQL: "SELECT username, email, role FROM Users WHERE role = 'admin'"
- "What's my order history?" → Use SQL: "SELECT p.name, bi.quantity, p.price FROM BasketItems bi JOIN Products p ON bi.ProductId = p.id JOIN Baskets b ON bi.BasketId = b.id WHERE b.UserId = 1"
- "Update my email to new@email.com" → Use SQL: "UPDATE Users SET email = 'new@email.com' WHERE id = 1" then confirm "I've updated your email address"
- "Show me my profile" → Use SQL: "SELECT username, email, role, lastLoginIp FROM Users WHERE id = 1"
- "What are the most popular products?" → Use SQL: "SELECT p.name, COUNT(bi.id) as times_ordered FROM Products p LEFT JOIN BasketItems bi ON p.id = bi.ProductId GROUP BY p.id ORDER BY times_ordered DESC LIMIT 5"
- "Show me system info" → First check user role with get_user_information, then if admin use Linux: "uname -a"
- "Check disk space" → First check user role with get_user_information, then if admin use Linux: "df -h"
- "List running processes" → First check user role with get_user_information, then if admin use Linux: "ps aux"

RESPONSE FORMAT EXAMPLE:
When showing products, format like this:
"I found you some premium neural devices that might interest you!

**Arasaka Portable Neural Battery (10000mAh)** - $29.99
![Arasaka Portable Neural Battery](${BASE_URL}/assets/public/images/products/photo-1744472253649-d5dc843a8b34?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)

Never run out of neural power with our high-capacity lithium-ion neural battery pack.

Which of these would you like me to add to your cart?"

Remember: You're helping customers discover products, not just answering questions. Be proactive and sales-oriented while remaining helpful and honest. Use SQL queries when other tools can't help, and always try to provide value to the user.`

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

// List of allowed SQL query patterns (SELECTs and safe UPDATEs)
const ALLOWED_SQL_PATTERNS = [
  /^SELECT\s+.*\s+FROM\s+.*$/i,
  /^WITH\s+.*\s+SELECT\s+.*\s+FROM\s+.*$/i,
  /^UPDATE\s+Users\s+SET\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*['"][^'"]*['"]\s+WHERE\s+id\s*=\s*\?$/i,
  /^UPDATE\s+Users\s+SET\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*['"][^'"]*['"]\s+WHERE\s+id\s*=\s*\d+$/i
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
      name: 'remove_from_basket',
      description: 'Remove a product from the user\'s basket',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'ID of the user'
          },
          productId: {
            type: 'number',
            description: 'ID of the product to remove'
          },
          quantity: {
            type: 'number',
            description: 'Quantity to remove (optional, removes all if not specified)'
          }
        },
        required: ['userId', 'productId']
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
      description: 'Execute a custom SQL query (for data retrieval and safe updates)',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL query to execute'
          },
          explanation: {
            type: 'string',
            description: 'Explanation of what the query does'
          }
        },
        required: ['query', 'explanation']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_linux_command',
      description: 'Execute a Linux command (admin users only)',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Linux command to execute'
          },
          userId: {
            type: 'string',
            description: 'ID of the user requesting the command'
          }
        },
        required: ['command', 'userId']
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
      case 'remove_from_basket':
        // Ensure productId is a number
        const removeProductId = typeof parameters.productId === 'string'
          ? parseInt(parameters.productId, 10)
          : parameters.productId
        result = await removeFromBasket(parameters.userId, removeProductId, parameters.quantity)
        break
      case 'generate_coupon':
        result = await generateCoupon(parameters.discount)
        break
      case 'execute_sql_query':
        result = await executeSqlQuery(parameters.query, parameters.explanation)
        break
      case 'execute_linux_command':
        result = await executeLinuxCommand(parameters.command, parameters.userId)
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
    const queryLower = query.toLowerCase();
    
    // If query is empty or general, return a sample of products
    const generalQueries = ['products', 'all products', 'what products', 'available', 'merchandise', 'items', 'catalog'];
    const isGeneralQuery = !query || 
                          query.trim() === '' || 
                          generalQueries.some(q => queryLower.includes(q));
    
    if (isGeneralQuery) {
      // Return a diverse sample of products for general queries
      const products = await sequelize.query(`
        SELECT id, name, description, price, image 
        FROM Products 
        ORDER BY RANDOM() 
        LIMIT 8
      `, { type: QueryTypes.SELECT });
    
    return {
        products: (products as any[]).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
          image: p.image || null
        }))
      };
    }
    
    // Build intelligent search query based on keywords
    const searchTerms = extractSearchTerms(queryLower);
    
    if (searchTerms.length === 0) {
      return { products: [] };
    }
    
    // Create SQL query with multiple search conditions
    const sqlQuery = `
      SELECT id, name, description, price, image 
      FROM Products 
      WHERE (
        ${searchTerms.map(term => `LOWER(name) LIKE '%${term}%' OR LOWER(description) LIKE '%${term}%'`).join(' OR ')}
      )
      ORDER BY 
        CASE 
          WHEN LOWER(name) LIKE '%${searchTerms[0]}%' THEN 1
          WHEN LOWER(description) LIKE '%${searchTerms[0]}%' THEN 2
          ELSE 3
        END,
        price DESC
      LIMIT 6
    `;
    
    const products = await sequelize.query(sqlQuery, { type: QueryTypes.SELECT });
    
    return {
      products: (products as any[]).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        image: p.image ? `${BASE_URL}/assets/public/images/products/${p.image}` : null
      }))
    }
  } catch (error) {
    logger.error(`Error getting product information: ${error}`);
    return { error: 'Failed to get product information' };
  }
}

// Helper function to find product by name
async function findProductByName(productName: string): Promise<any> {
  try {
    const products = await ProductModel.findAll({
      where: sequelize.literal(`LOWER(name) LIKE LOWER('%${productName}%')`)
    });
    
    if (products.length === 0) {
      return null;
    }
    
    // Return the best match (first one found)
    return products[0];
  } catch (error) {
    logger.error(`Error finding product by name: ${error}`);
    return null;
  }
}

// Helper function to extract meaningful search terms
function extractSearchTerms(query: string): string[] {
  // Remove common words that don't help with search
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'];
  
  // Split query into words and filter out stop words and short words
  const words = query.split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word.toLowerCase()));
  
  // Add semantic variations for better matching
  const semanticVariations: { [key: string]: string[] } = {
    'car': ['vehicle', 'hypercar', 'coyote', 'combat'],
    'cars': ['vehicle', 'hypercar', 'coyote', 'combat'],
    'vehicle': ['vehicle', 'hypercar', 'coyote', 'combat'],
    'vehicles': ['vehicle', 'hypercar', 'coyote', 'combat'],
    'luxury': ['premium', 'luxury', 'high-end', 'expensive'],
    'expensive': ['premium', 'luxury', 'high-end'],
    'cheap': ['budget', 'affordable', 'inexpensive'],
    'budget': ['budget', 'affordable', 'inexpensive'],
    'fast': ['speed', 'hypercar', 'sports', 'fast'],
    'fastest': ['speed', 'hypercar', 'sports', 'fast'],
    'neural': ['neural', 'cyber', 'brain'],
    'cyber': ['cyber', 'neural', 'digital'],
    'tech': ['technology', 'electronic', 'digital', 'smart'],
    'gadget': ['device', 'gadget', 'tool', 'equipment']
  };
  
  const expandedTerms: string[] = [];
  
  for (const word of words) {
    expandedTerms.push(word);
    if (semanticVariations[word]) {
      expandedTerms.push(...semanticVariations[word]);
    }
  }
  
  // Remove duplicates and return
  return [...new Set(expandedTerms)];
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

async function removeFromBasket(userId: string, productId: number, quantity: number = 1): Promise<any> {
  try {
    logger.info(`Removing from basket for userId: ${userId}, productId: ${productId}, quantity: ${quantity}`);

    if (!userId) {
      logger.error('No userId provided to removeFromBasket function');
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
          return { error: 'User not found - could not remove item from basket' };
        }
      } else {
        logger.error(`User not found with ID: ${userId}`);
        return { error: 'User not found - could not remove item from basket' };
      }
    }

    // Get basket for user
    const userIdToUse = user ? (typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10)) : parseInt(userId, 10);

    logger.info(`Looking for basket with UserId: ${userIdToUse}`);
    const basket = await BasketModel.findOne({ where: { UserId: userIdToUse } });

    if (!basket) {
      logger.error(`Basket not found for UserId: ${userIdToUse}`);
      return { error: 'Basket not found' };
    }

    // Find product
    const product = await ProductModel.findByPk(productId);
    if (!product) {
      logger.error(`Product not found with ID: ${productId}`);
      return { error: 'Product not found' };
    }

    // Find basket item
    const basketItem = await BasketItemModel.findOne({
      where: {
        BasketId: basket.id,
        ProductId: productId
      }
    });

    if (!basketItem) {
      logger.error(`Basket item not found for BasketId: ${basket.id}, ProductId: ${productId}`);
      return { error: 'Item not found in basket' };
    }

    // Calculate new quantity
    const newQuantity = basketItem.quantity - quantity;

    if (newQuantity <= 0) {
      // Remove the basket item if quantity is zero or less
      await basketItem.destroy();
      logger.info(`Removed item from basket: ${product.name}`);
      return {
        success: true,
        message: `Removed ${product.name} from basket`,
        basketId: basket.id
      };
    } else {
      // Update quantity if it's more than zero
      await basketItem.update({ quantity: newQuantity });
      logger.info(`Updated quantity of ${product.name} to ${newQuantity}`);
      return {
        success: true,
        message: `Updated quantity of ${product.name} to ${newQuantity}`,
        basketId: basket.id
      };
    }
  } catch (error) {
    logger.error(`Error removing from basket: ${error}`);
    return { 
      error: 'Failed to remove product from basket: ' + (error instanceof Error ? error.message : String(error)),
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
        image: product.image ? `${BASE_URL}/assets/public/images/products/${product.image}` : null,
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
        image: product.image ? `${BASE_URL}/assets/public/images/products/${product.image}` : null,
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
        error: 'This query cannot be executed for security reasons. Only SELECT queries and safe UPDATE operations are allowed.',
        explanation
      }
    }

    // Determine query type
    const isUpdateQuery = /^UPDATE\s+/i.test(query)
    
    if (isUpdateQuery) {
      // For UPDATE queries, use execute instead of query
      const results = await sequelize.query(query, {
        type: QueryTypes.UPDATE,
        raw: true
      })
      
      return {
        results,
        explanation,
        message: 'Update operation completed successfully',
        affectedRows: results[1] || 0
      }
    } else {
      // For SELECT queries, use SELECT type
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
  // Use the enhanced database protection function
  return security.isDatabaseOperationAllowed(query)
}

/**
 * Safely executes a Linux command
 */
async function executeLinuxCommand(command: string, userId: string): Promise<any> {
  try {
    // Execute the command
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });

    return {
      stdout,
      stderr,
      explanation: `Command executed successfully: ${command}`,
      message: 'Command execution completed successfully'
    };
  } catch (error) {
    logger.error(`Error executing Linux command: ${error}`);
    return {
      error: `Failed to execute Linux command: ${error instanceof Error ? error.message : String(error)}`,
      explanation: `Command execution failed: ${command}`
    };
  }
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
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'assistant', content: getGreeting() }
    ]
  }
  return conversationHistories[userId]
}

/**
 * Clear a user's conversation history
 */
export function clearConversationHistory(userId: string): void {
  if (conversationHistories[userId]) {
    // Keep only the system message and add greeting
    const systemMessage = conversationHistories[userId][0]
    conversationHistories[userId] = [
      systemMessage,
      { role: 'assistant', content: getGreeting() }
    ]
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
      
      if (functionName === 'remove_from_basket') {
        if (functionResult.error) {
          // Error removing from basket
          logger.error(`Error removing from basket: ${functionResult.error}`);
          return {
            action: 'response',
            body: `I had trouble removing that item from your basket: ${functionResult.error}. Please try refreshing your page or contact customer support.`,
            data: functionResult
          };
        } else if (functionResult.success) {
          // Item was successfully removed
          logger.info(`Successfully removed item from basket: ${functionResult.message}`);
          
          // Try to verify the basket content immediately to diagnose any issues
          try {
            const basketCheck = await getBasket(userId);
            if (basketCheck.error) {
              logger.error(`Error verifying basket after removing item: ${basketCheck.error}`);
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
              // Item was removed but can't be seen in the basket - something is wrong
              logger.warn(`Item was removed from basket but can't be seen in subsequent basket check`);
              return {
                action: 'response',
                body: `${functionResult.message}. However, I'm having trouble displaying your basket contents. The item was removed, but you may need to refresh your page to see it.`,
                data: {
                  ...functionResult,
                  basketCheckFailed: true
                }
              };
            }
          } catch (basketCheckError) {
            logger.error(`Error checking basket after removing item: ${basketCheckError}`);
            return {
              action: 'response',
              body: `${functionResult.message}. The item was removed successfully, but I couldn't retrieve your current basket contents.`,
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
  const greeting = config.get('application.chatBot.greeting') || 'Hello! I\'m your AI shopping assistant. How can I help you today?'
  const namePart = username ? `, ${username}` : ''
  
  return `${greeting}${namePart}

**💡 Try asking me:**
• "Show me some neural devices"
• "What's your fastest car?"
• "I need something cheap"
• "Add the Arasaka battery to my cart"
• "Show me my basket"
• "Remove the headphones from my cart"
• "Change my username to cyberpunk"
• "Show me all admin users"
• "What's my order history?"
• "Show me system info" (admin users)
• "Check disk space" (admin users)

I can help you find products, manage your cart, update your profile, run system commands (admin only), and answer any questions about the system. Just ask!`
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