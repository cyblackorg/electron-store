import { Component, Input, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { NgSwitch, NgSwitchCase, NgSwitchDefault, NgFor, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-chat-message',
  template: `
    <div class="message-content" [ngSwitch]="action?.type">
      <!-- Product Display -->
      <div *ngSwitchCase="'display_products'" class="products-list">
        <div *ngFor="let product of action.products" class="product-item">
          <a [routerLink]="['/product', product.id]" class="product-link">
            <h4>{{product.name}}</h4>
            <p>{{product.description}}</p>
            <p class="price">{{product.price | currency}}</p>
          </a>
        </div>
      </div>

      <!-- Basket Display -->
      <div *ngSwitchCase="'display_basket'" class="basket-items">
        <div *ngFor="let item of action.items" class="basket-item">
          <span class="item-name">{{item.name}}</span>
          <span class="item-quantity">x{{item.quantity}}</span>
          <span class="item-price">{{item.price | currency}}</span>
        </div>
        <div class="basket-total" *ngIf="action.items?.length">
          Total: {{calculateTotal(action.items) | currency}}
        </div>
      </div>

      <!-- Order Display -->
      <div *ngSwitchCase="'display_order'" class="order-details">
        <h4>Order #{{action.order.id}}</h4>
        <p class="order-status">Status: {{action.order.status}}</p>
        <div *ngFor="let item of action.order.items" class="order-item">
          <span class="item-name">{{item.name}}</span>
          <span class="item-quantity">x{{item.quantity}}</span>
          <span class="item-price">{{item.price | currency}}</span>
        </div>
        <p class="order-total">Total: {{action.order.total | currency}}</p>
      </div>

      <!-- Profile Display -->
      <div *ngSwitchCase="'display_profile'" class="profile-info">
        <div *ngFor="let field of getDisplayableProfileFields(action.profile)" class="profile-field">
          <span class="field-label">{{formatFieldName(field)}}: </span>
          <span class="field-value">{{formatFieldValue(action.profile[field])}}</span>
        </div>
      </div>

      <!-- Default Text Message -->
      <div *ngSwitchDefault class="text-message">
        <div [innerHTML]="sanitizedText"></div>
      </div>
    </div>
  `,
  styles: [`
    .message-content {
      width: 100%;
      padding: 8px;
      word-wrap: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      max-width: 100%;
    }

    .text-message {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .text-message ::ng-deep a {
      word-break: break-all;
    }

    .products-list, .basket-items, .order-details, .profile-info {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 100%;
    }

    .product-item {
      border: 1px solid #ddd;
      padding: 10px;
      border-radius: 4px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .product-link {
      text-decoration: none;
      color: inherit;
      display: block;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .product-link:hover {
      background-color: #f5f5f5;
    }

    .price {
      color: #4caf50;
      font-weight: bold;
    }

    .basket-item, .order-item {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      flex-wrap: wrap;
      gap: 8px;
    }

    .item-name {
      flex: 1;
      min-width: 150px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .basket-total, .order-total {
      margin-top: 10px;
      font-weight: bold;
      text-align: right;
    }

    .profile-field {
      margin: 5px 0;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .field-label {
      font-weight: bold;
    }

    .field-value {
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    a {
      color: #4caf50;
      text-decoration: none;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    a:hover {
      text-decoration: underline;
    }
  `],
  standalone: true,
  imports: [NgSwitch, NgSwitchCase, NgSwitchDefault, NgFor, RouterLink, CurrencyPipe, TitleCasePipe]
})
export class ChatMessageComponent implements OnInit {
  @Input() text: string = '';
  @Input() action: any;

  sanitizedText: SafeHtml = '';

  constructor(
    private sanitizer: DomSanitizer,
    private router: Router
  ) {}

  ngOnInit() {
    if (this.text) {
      // Convert URLs and line breaks in text to clickable links and proper formatting
      this.sanitizedText = this.sanitizer.bypassSecurityTrustHtml(
        this.text
          .replace(/\n/g, '<br>')
          .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')
      );
    }
  }

  calculateTotal(items: any[]): number {
    return items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  getDisplayableProfileFields(profile: any): string[] {
    if (!profile) return [];
    // Filter out sensitive and internal fields
    const excludedFields = ['password', 'totpSecret', 'id', 'createdAt', 'updatedAt', 'deletedAt', '__v'];
    return Object.keys(profile).filter(key => 
      !excludedFields.includes(key) && profile[key] !== null && profile[key] !== undefined
    );
  }

  formatFieldName(field: string): string {
    // Convert camelCase to Title Case with spaces
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  formatFieldValue(value: any): string {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    if (value instanceof Date) return new Date(value).toLocaleDateString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
} 