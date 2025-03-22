/*
 * Copyright (c) 2014-2025 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import {
  Model,
  type InferAttributes,
  type InferCreationAttributes,
  DataTypes,
  type CreationOptional,
  type Sequelize
} from 'sequelize'

class Chat extends Model<
InferAttributes<Chat>,
InferCreationAttributes<Chat>
> {
  declare id: CreationOptional<number>
  declare UserId: number
  declare message: string
  declare timestamp: CreationOptional<Date>
  declare role: 'user' | 'assistant'
}

const ChatModelInit = (sequelize: Sequelize) => {
  Chat.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      role: {
        type: DataTypes.ENUM('user', 'assistant'),
        allowNull: false
      }
    },
    {
      tableName: 'Chats',
      sequelize
    }
  )
}

export { Chat as ChatModel, ChatModelInit } 