// Simple test script for chatbot
const { Bot } = require('juicy-chat-bot')
const fs = require('fs')

async function testBot() {
  console.log('Loading training data...')
  const trainingData = fs.readFileSync('data/chatbot/botDefaultTrainingData.json', 'utf8')
  console.log('Creating bot...')
  const bot = new Bot(
    'Volty', 
    "Welcome to Electron Store! I'm <bot-name>, how can I assist you today, <customer-name>?", 
    trainingData, 
    "I didn't quite catch that. Could you rephrase your question?"
  )
  
  console.log('Training bot...')
  await bot.train()
  console.log('Bot training state:', bot.training.state)
  
  // Add a test user
  console.log('Adding test user...')
  bot.addUser('test123', 'TestUser')
  
  // Test some queries
  async function testQuery(query) {
    console.log(`\nTesting query: "${query}"`)
    try {
      const response = await bot.respond(query, 'test123')
      console.log('Response:', response)
    } catch (error) {
      console.error('Error:', error)
    }
  }
  
  await testQuery('hello')
  await testQuery('what are deluxe membership benefits')
  await testQuery('how much is apple juice')
  await testQuery('can I have a coupon code')
  await testQuery('nonsense query that should trigger default response')
}

testBot().catch(console.error) 