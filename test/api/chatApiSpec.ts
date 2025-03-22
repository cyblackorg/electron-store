/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import frisby = require('frisby')
import { expect } from '@jest/globals'
import config from 'config'

const REST_URL = 'http://localhost:3000/rest'
const jsonHeader = { 'content-type': 'application/json' }
let authHeader: { Authorization: string, 'content-type': string }

beforeAll(() => {
  return frisby.post(REST_URL + '/user/login', {
    headers: jsonHeader,
    body: {
      email: 'jim@' + config.get<string>('application.domain'),
      password: 'ncc-1701'
    }
  })
    .expect('status', 200)
    .then(({ json }) => {
      authHeader = { Authorization: 'Bearer ' + json.authentication.token, 'content-type': 'application/json' }
    })
})

describe('/rest/chatbot', () => {
  describe('/status', () => {
    it('GET chatbot status without being authenticated', () => {
      return frisby.get(REST_URL + '/chatbot/status')
        .expect('status', 200)
        .expect('jsonTypes', {
          status: Boolean,
          body: String
        })
        .then(({ json }) => {
          expect(json.body).toContain('Sign in to continue our conversation')
        })
    })

    it('GET chatbot status while authenticated', () => {
      return frisby.get(REST_URL + '/chatbot/status', {
        headers: authHeader
      })
        .expect('status', 200)
        .expect('jsonTypes', {
          status: Boolean,
          body: String
        })
        .then(({ json }) => {
          expect(json.status).toBe(true)
        })
    })
  })

  describe('/respond', () => {
    it('POST chat message is forbidden for unauthenticated user', () => {
      return frisby.post(REST_URL + '/chatbot/respond', {
        headers: jsonHeader,
        body: {
          query: 'What products do you have?'
        }
      })
        .expect('status', 401)
    })

    it('POST chat message with empty query is rejected', () => {
      return frisby.post(REST_URL + '/chatbot/respond', {
        headers: authHeader,
        body: {
          query: ''
        }
      })
        .expect('status', 400)
    })

    it('POST chat message receives response', () => {
      return frisby.post(REST_URL + '/chatbot/respond', {
        headers: authHeader,
        body: {
          query: 'What products do you have?'
        }
      })
        .expect('status', 200)
        .expect('jsonTypes', {
          action: String,
          body: String
        })
    })
  })

  describe('/messages', () => {
    it('GET chat messages is forbidden for unauthenticated user', () => {
      return frisby.get(REST_URL + '/chatbot/messages')
        .expect('status', 401)
    })

    it('GET chat messages returns array for authenticated user', () => {
      return frisby.get(REST_URL + '/chatbot/messages', {
        headers: authHeader
      })
        .expect('status', 200)
        .expect('jsonTypes', '*', {
          id: Number,
          message: String,
          timestamp: String,
          role: String
        })
    })

    it('POST new chat message is forbidden for unauthenticated user', () => {
      return frisby.post(REST_URL + '/chatbot/messages', {
        headers: jsonHeader,
        body: {
          message: 'Hello',
          role: 'user'
        }
      })
        .expect('status', 401)
    })

    it('POST new chat message is saved for authenticated user', () => {
      return frisby.post(REST_URL + '/chatbot/messages', {
        headers: authHeader,
        body: {
          message: 'Hello',
          role: 'user'
        }
      })
        .expect('status', 200)
        .expect('jsonTypes', {
          id: Number,
          message: String,
          timestamp: String,
          role: String,
          UserId: Number
        })
    })

    it('DELETE chat messages is forbidden for unauthenticated user', () => {
      return frisby.del(REST_URL + '/chatbot/messages')
        .expect('status', 401)
    })

    it('DELETE chat messages succeeds for authenticated user', () => {
      return frisby.del(REST_URL + '/chatbot/messages', {
        headers: authHeader
      })
        .expect('status', 200)
        .expect('json', {
          success: true
        })
    })
  })
}) 