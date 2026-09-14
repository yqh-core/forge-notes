---
title: 跨境电商支付系统技术选型与集成实战
date: 2025-11-30
tags:
  - 跨境电商
  - 支付集成
  - Stripe
  - PayPal
  - 技术架构
---

# 跨境电商支付系统技术选型与集成实战

支付系统是跨境电商的核心环节。本文将深入分析主流支付网关的特点、技术实现和最佳实践，帮助你选择最适合的支付解决方案。

## 主流支付网关对比

### 1. Stripe

**适用场景：** 全球市场，特别是欧美地区

**优势：**
- ✅ 开发者友好的 API
- ✅ 支持 135+ 货币
- ✅ 丰富的支付方式
- ✅ 完善的文档和工具
- ✅ 强大的反欺诈系统

**费用：**
```
标准费率：2.9% + $0.30 每笔
国际卡：+1.5%
货币转换：+1%
```

### 2. PayPal

**适用场景：** 全球通用，用户基数大

**优势：**
- ✅ 用户认知度高
- ✅ 买家保护计划
- ✅ 无需信用卡
- ✅ 多种集成方式

**费用：**
```
标准费率：2.9% + $0.30 每笔
跨境交易：+1.5%
货币转换：3-4%
```

### 3. 其他支付方式

```typescript
// 不同地区的首选支付方式
const regionalPayments = {
  US: ['Stripe', 'PayPal', 'Apple Pay', 'Google Pay'],
  EU: ['Stripe', 'PayPal', 'SEPA', 'Klarna'],
  UK: ['Stripe', 'PayPal', 'Klarna'],
  CN: ['Alipay', 'WeChat Pay', 'UnionPay'],
  JP: ['Stripe', 'PayPay', 'Line Pay'],
  BR: ['PagSeguro', 'Mercado Pago'],
  IN: ['Razorpay', 'PayTM', 'UPI']
};
```

## Stripe 集成实战

### 1. 基础配置

```bash
# 安装 Stripe SDK
npm install stripe @stripe/stripe-js @stripe/react-stripe-js
```

```typescript
// lib/stripe.ts
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20',
  typescript: true,
});

// 客户端配置
import { loadStripe } from '@stripe/stripe-js';

export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);
```

### 2. 创建支付意图

```typescript
// app/api/create-payment-intent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const { amount, currency, metadata } = await req.json();

    // 创建 Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // 转换为最小货币单位
      currency: currency.toLowerCase(),
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        orderId: metadata.orderId,
        userId: metadata.userId,
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Payment Intent Error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment intent' },
      { status: 500 }
    );
  }
}
```

### 3. 前端结账页面

```typescript
// components/CheckoutForm.tsx
'use client';

import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
  Elements,
} from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';

function CheckoutForm({ amount, currency }: {
  amount: number;
  currency: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);

    // 创建 Payment Intent
    const response = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        currency,
        metadata: {
          orderId: 'ORDER-123',
          userId: 'USER-456',
        },
      }),
    });

    const { clientSecret, error: backendError } = await response.json();

    if (backendError) {
      setErrorMessage(backendError);
      setLoading(false);
      return;
    }

    // 确认支付
    const { error } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/payment/success`,
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      {errorMessage && (
        <div className="error-message">{errorMessage}</div>
      )}

      <button
        type="submit"
        disabled={!stripe || loading}
        className="pay-button"
      >
        {loading ? 'Processing...' : `Pay ${currency} ${amount}`}
      </button>
    </form>
  );
}

// 使用 Elements Provider 包装
export function StripeCheckout({ amount, currency }: {
  amount: number;
  currency: string;
}) {
  const options = {
    mode: 'payment' as const,
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    appearance: {
      theme: 'stripe' as const,
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <CheckoutForm amount={amount} currency={currency} />
    </Elements>
  );
}
```

### 4. Webhook 处理

```typescript
// app/api/webhooks/stripe/route.ts
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import Stripe from 'stripe';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    // 验证 webhook 签名
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  // 处理不同的事件类型
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      await handlePaymentSuccess(paymentIntent);
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object as Stripe.PaymentIntent;
      await handlePaymentFailure(failedPayment);
      break;

    case 'charge.refunded':
      const refund = event.data.object as Stripe.Charge;
      await handleRefund(refund);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata.orderId;

  // 更新订单状态
  await updateOrderStatus(orderId, 'paid');

  // 发送确认邮件
  await sendOrderConfirmationEmail(orderId);

  // 触发发货流程
  await initiateShipping(orderId);
}

async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  const orderId = paymentIntent.metadata.orderId;

  // 记录失败原因
  await logPaymentFailure(orderId, paymentIntent.last_payment_error);

  // 通知客户
  await sendPaymentFailureEmail(orderId);
}

async function handleRefund(charge: Stripe.Charge) {
  // 处理退款逻辑
  console.log('Refund processed:', charge.id);
}
```

## PayPal 集成实战

### 1. 基础配置

```bash
npm install @paypal/react-paypal-js
```

```typescript
// components/PayPalButton.tsx
'use client';

import {
  PayPalScriptProvider,
  PayPalButtons,
} from '@paypal/react-paypal-js';

export function PayPalCheckout({ amount, currency, onSuccess }: {
  amount: number;
  currency: string;
  onSuccess: (orderId: string) => void;
}) {
  return (
    <PayPalScriptProvider
      options={{
        clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!,
        currency: currency,
        intent: 'capture',
      }}
    >
      <PayPalButtons
        style={{
          layout: 'vertical',
          color: 'gold',
          shape: 'rect',
          label: 'paypal',
        }}
        createOrder={async () => {
          // 创建订单
          const response = await fetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, currency }),
          });

          const data = await response.json();
          return data.orderId;
        }}
        onApprove={async (data) => {
          // 捕获支付
          const response = await fetch('/api/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          });

          const details = await response.json();

          if (details.status === 'COMPLETED') {
            onSuccess(data.orderID);
          }
        }}
        onError={(err) => {
          console.error('PayPal Error:', err);
        }}
      />
    </PayPalScriptProvider>
  );
}
```

### 2. 服务端 API

```typescript
// app/api/paypal/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PAYPAL_API = 'https://api-m.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');

  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  return data.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const { amount, currency } = await req.json();
    const accessToken = await getAccessToken();

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: currency,
              value: amount.toFixed(2),
            },
          },
        ],
      }),
    });

    const order = await response.json();
    return NextResponse.json({ orderId: order.id });
  } catch (error) {
    console.error('PayPal Create Order Error:', error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}
```

## 多支付方式集成

### 统一支付接口

```typescript
// lib/payment-gateway.ts
export interface PaymentGateway {
  createPayment(params: PaymentParams): Promise<PaymentResult>;
  capturePayment(paymentId: string): Promise<CaptureResult>;
  refundPayment(paymentId: string, amount: number): Promise<RefundResult>;
}

export interface PaymentParams {
  amount: number;
  currency: string;
  orderId: string;
  customerId: string;
  metadata?: Record<string, any>;
}

export interface PaymentResult {
  paymentId: string;
  status: 'pending' | 'succeeded' | 'failed';
  clientSecret?: string;
}

// Stripe 实现
class StripeGateway implements PaymentGateway {
  async createPayment(params: PaymentParams): Promise<PaymentResult> {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(params.amount * 100),
      currency: params.currency,
      customer: params.customerId,
      metadata: params.metadata,
    });

    return {
      paymentId: paymentIntent.id,
      status: paymentIntent.status as any,
      clientSecret: paymentIntent.client_secret!,
    };
  }

  async capturePayment(paymentId: string): Promise<CaptureResult> {
    const paymentIntent = await stripe.paymentIntents.capture(paymentId);
    return {
      success: paymentIntent.status === 'succeeded',
      amount: paymentIntent.amount / 100,
    };
  }

  async refundPayment(paymentId: string, amount: number): Promise<RefundResult> {
    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      amount: Math.round(amount * 100),
    });

    return {
      success: refund.status === 'succeeded',
      refundId: refund.id,
    };
  }
}

// PayPal 实现
class PayPalGateway implements PaymentGateway {
  // 实现类似的接口...
}

// 支付网关工厂
export class PaymentGatewayFactory {
  static create(gateway: 'stripe' | 'paypal'): PaymentGateway {
    switch (gateway) {
      case 'stripe':
        return new StripeGateway();
      case 'paypal':
        return new PayPalGateway();
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }
}
```

### 智能路由选择

```typescript
// 根据用户位置和偏好选择支付方式
export function selectPaymentGateway(
  country: string,
  preferredMethod?: string
): 'stripe' | 'paypal' | 'alipay' {
  // 用户偏好优先
  if (preferredMethod) {
    return preferredMethod as any;
  }

  // 根据地区选择
  const gatewayPreferences: Record<string, string> = {
    US: 'stripe',
    UK: 'stripe',
    EU: 'stripe',
    CN: 'alipay',
    JP: 'stripe',
  };

  return (gatewayPreferences[country] || 'stripe') as any;
}
```

## 安全性最佳实践

### 1. PCI DSS 合规

```typescript
// 永远不要在服务器端存储信用卡信息
// ❌ 错误做法
interface BadPractice {
  cardNumber: string; // 不要存储
  cvv: string; // 不要存储
  expiryDate: string; // 不要存储
}

// ✅ 正确做法 - 使用 Token
interface GoodPractice {
  paymentMethodId: string; // Stripe Payment Method ID
  last4: string; // 仅存储后4位用于显示
  brand: string; // 卡品牌（Visa, Mastercard）
  expiryMonth: number;
  expiryYear: number;
}
```

### 2. 防止欺诈

```typescript
// 欺诈检测系统
class FraudDetection {
  async analyzeTransaction(transaction: Transaction): Promise<{
    riskScore: number;
    shouldBlock: boolean;
    reasons: string[];
  }> {
    const checks = await Promise.all([
      this.checkVelocity(transaction.userId),
      this.checkLocation(transaction.ipAddress, transaction.billingCountry),
      this.checkAmount(transaction.amount, transaction.userId),
      this.checkDevice(transaction.deviceId),
    ]);

    const riskScore = checks.reduce((sum, check) => sum + check.score, 0);
    const reasons = checks.flatMap((check) => check.reasons);

    return {
      riskScore,
      shouldBlock: riskScore > 80,
      reasons,
    };
  }

  // 检查交易频率
  private async checkVelocity(userId: string) {
    const recentTransactions = await getRecentTransactions(userId, 24); // 24小时内

    if (recentTransactions.length > 10) {
      return {
        score: 50,
        reasons: ['High transaction velocity'],
      };
    }

    return { score: 0, reasons: [] };
  }

  // 检查地理位置异常
  private async checkLocation(ipAddress: string, billingCountry: string) {
    const ipCountry = await getCountryFromIP(ipAddress);

    if (ipCountry !== billingCountry) {
      return {
        score: 30,
        reasons: ['IP and billing country mismatch'],
      };
    }

    return { score: 0, reasons: [] };
  }
}
```

### 3. 3D Secure 验证

```typescript
// Stripe 3D Secure
const paymentIntent = await stripe.paymentIntents.create({
  amount: amount * 100,
  currency: currency,
  payment_method_types: ['card'],
  // 强制 3D Secure
  payment_method_options: {
    card: {
      request_three_d_secure: 'any', // 'automatic' | 'any'
    },
  },
});
```

## 退款与争议处理

### 退款流程

```typescript
// app/api/refund/route.ts
export async function POST(req: NextRequest) {
  const { paymentId, amount, reason } = await req.json();

  try {
    // 创建退款
    const refund = await stripe.refunds.create({
      payment_intent: paymentId,
      amount: amount ? Math.round(amount * 100) : undefined, // 部分退款
      reason: reason, // 'duplicate' | 'fraudulent' | 'requested_by_customer'
      metadata: {
        timestamp: new Date().toISOString(),
        processedBy: 'admin',
      },
    });

    // 更新订单状态
    await updateOrderStatus(paymentId, 'refunded');

    // 发送退款确认邮件
    await sendRefundConfirmation(paymentId, refund.amount / 100);

    return NextResponse.json({
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
    });
  } catch (error) {
    console.error('Refund Error:', error);
    return NextResponse.json(
      { error: 'Refund failed' },
      { status: 500 }
    );
  }
}
```

### 争议管理

```typescript
// 处理 Stripe 争议
async function handleDispute(dispute: Stripe.Dispute) {
  // 自动提交证据
  const evidence = {
    customer_name: await getCustomerName(dispute.payment_intent),
    customer_email_address: await getCustomerEmail(dispute.payment_intent),
    billing_address: await getBillingAddress(dispute.payment_intent),
    shipping_address: await getShippingAddress(dispute.payment_intent),
    shipping_tracking_number: await getTrackingNumber(dispute.payment_intent),
    product_description: await getProductDescription(dispute.payment_intent),
  };

  await stripe.disputes.update(dispute.id, {
    evidence: evidence,
    submit: true,
  });
}
```

## 性能优化

### 1. 支付页面优化

```typescript
// 预加载 Stripe.js
import { loadStripe } from '@stripe/stripe-js';

// 在应用初始化时预加载
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

// 使用 React Suspense 优化加载
import { Suspense } from 'react';

export function CheckoutPage() {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <StripeCheckout />
    </Suspense>
  );
}
```

### 2. 缓存支付方式

```typescript
// 缓存用户的支付方式
async function getCachedPaymentMethods(customerId: string) {
  const cacheKey = `payment_methods:${customerId}`;

  // 尝试从缓存获取
  let paymentMethods = await redis.get(cacheKey);

  if (!paymentMethods) {
    // 从 Stripe 获取
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    paymentMethods = methods.data;

    // 缓存 5 分钟
    await redis.setex(cacheKey, 300, JSON.stringify(paymentMethods));
  }

  return JSON.parse(paymentMethods);
}
```

## 监控与分析

### 支付指标追踪

```typescript
// 关键支付指标
interface PaymentMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRate: number; // %
  averageTransactionValue: number;
  totalRevenue: number;
  refundRate: number; // %
  chargebackRate: number; // %
}

async function calculatePaymentMetrics(
  startDate: Date,
  endDate: Date
): Promise<PaymentMetrics> {
  const transactions = await getTransactions(startDate, endDate);

  const successful = transactions.filter((t) => t.status === 'succeeded');
  const failed = transactions.filter((t) => t.status === 'failed');
  const refunded = transactions.filter((t) => t.refunded);

  return {
    totalTransactions: transactions.length,
    successfulTransactions: successful.length,
    failedTransactions: failed.length,
    successRate: (successful.length / transactions.length) * 100,
    averageTransactionValue:
      successful.reduce((sum, t) => sum + t.amount, 0) / successful.length,
    totalRevenue: successful.reduce((sum, t) => sum + t.amount, 0),
    refundRate: (refunded.length / successful.length) * 100,
    chargebackRate: 0, // 从 Stripe Dashboard 获取
  };
}
```

## 总结

选择合适的支付系统需要考虑：

1. **目标市场** - 不同地区用户的支付习惯
2. **费用成本** - 交易费率和固定费用
3. **开发成本** - API 友好度和集成难度
4. **安全合规** - PCI DSS 和数据保护
5. **用户体验** - 结账流程的顺畅度

**推荐方案：**
- 主要支付：Stripe（全球）+ PayPal（备选）
- 区域支付：根据目标市场添加本地支付方式
- 安全措施：启用 3D Secure + 欺诈检测

---

*发布于 2025-11-30 | 跨境电商系列*
