export interface ChatMessage {
  id?: number;
  message: string;
  role: 'user' | 'assistant';
  timestamp?: Date;
}

export interface ChatIntent {
  type: 'general' | 'product_search' | 'basket' | 'profile' | 'order' | 'custom';
  confidence: number;
}

export interface ProductSearchParams {
  query?: string;
  category?: string;
  priceRange?: {
    min?: number;
    max?: number;
  };
  sortBy?: 'price' | 'name' | 'rating';
}

export interface BasketParams {
  action: 'view' | 'add' | 'remove' | 'update';
  productName?: string;
  quantity?: number;
}

export interface ProfileParams {
  action: 'view' | 'update';
  field?: string;
  value?: string;
}

export interface OrderParams {
  action: 'status' | 'details' | 'track';
  orderId?: string;
}

export interface CustomParams {
  objective: string;
  constraints?: string[];
  entities?: string[];
}

export interface ParsedParameters {
  productSearch?: ProductSearchParams;
  basket?: BasketParams;
  profile?: ProfileParams;
  order?: OrderParams;
  custom?: CustomParams;
}

export interface ChatResponse {
  text: string;
  error?: boolean;
  success?: boolean;
  requiresConfirmation?: boolean;
  suggestions?: string[];
  action?: {
    type: string;
    [key: string]: any;
  };
}

export interface ResolvedProduct {
  id: number;
  name: string;
  price: number;
  matches: number;
} 