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
            <div class="product-image" *ngIf="product.image">
              <img [src]="product.image" [alt]="product.name" class="product-img">
            </div>
            <div class="product-info">
              <h4>{{product.name}}</h4>
              <p class="product-description">{{product.description}}</p>
              <p class="price">{{product.price | currency}}</p>
            </div>
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

      <!-- Default Text Message with Enhanced HTML/Markdown Support -->
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

    .text-message ::ng-deep {
      /* Enhanced styling for HTML content */
      line-height: 1.5;
    }

    .text-message ::ng-deep a {
      color: #4caf50;
      text-decoration: none;
      word-break: break-all;
    }

    .text-message ::ng-deep a:hover {
      text-decoration: underline;
    }

    .text-message ::ng-deep img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 8px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .text-message ::ng-deep strong, .text-message ::ng-deep b {
      font-weight: bold;
    }

    .text-message ::ng-deep em, .text-message ::ng-deep i {
      font-style: italic;
    }

    .text-message ::ng-deep code {
      background-color: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 0.9em;
    }

    .text-message ::ng-deep pre {
      background-color: #f5f5f5;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }

    .text-message ::ng-deep blockquote {
      border-left: 4px solid #4caf50;
      padding-left: 12px;
      margin: 8px 0;
      color: #666;
    }

    .text-message ::ng-deep ul, .text-message ::ng-deep ol {
      padding-left: 20px;
      margin: 8px 0;
    }

    .text-message ::ng-deep li {
      margin: 4px 0;
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
      border-radius: 8px;
      word-wrap: break-word;
      overflow-wrap: break-word;
      transition: box-shadow 0.2s ease;
    }

    .product-item:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .product-link {
      text-decoration: none;
      color: inherit;
      display: flex;
      gap: 12px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .product-image {
      flex-shrink: 0;
      width: 80px;
      height: 80px;
    }

    .product-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 6px;
    }

    .product-info {
      flex: 1;
      min-width: 0;
    }

    .product-description {
      color: #666;
      font-size: 0.9em;
      margin: 4px 0;
      line-height: 1.4;
    }

    .price {
      color: #4caf50;
      font-weight: bold;
      margin: 4px 0 0 0;
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
      // Enhanced HTML/markdown processing
      this.sanitizedText = this.sanitizer.bypassSecurityTrustHtml(
        this.processMarkdown(this.text)
      );
    }
  }

  private processMarkdown(text: string): string {
    return text
      // Convert line breaks to <br>
      .replace(/\n/g, '<br>')
      
      // Convert URLs to clickable links
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')
      
      // Convert **bold** to <strong>
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      
      // Convert *italic* to <em>
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      
      // Convert `code` to <code>
      .replace(/`(.*?)`/g, '<code>$1</code>')
      
      // Convert markdown links [text](url) to HTML links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      
      // Convert markdown images ![alt](url) to HTML images
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">')
      
      // Convert simple image URLs to <img> tags (for product images)
      .replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))(?![^<]*>)/gi, '<img src="$1" alt="Product image" style="max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">')
      
      // Convert bullet points to HTML lists
      .replace(/^•\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      
      // Convert numbered lists
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>');
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