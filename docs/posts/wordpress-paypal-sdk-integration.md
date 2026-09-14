---
title: WordPress电商网站如何接入PayPal SDK：完整开发指南
date: 2025-12-05
tags:
  - WordPress
  - PayPal
  - 电商支付
  - WooCommerce
---

# WordPress电商网站如何接入PayPal SDK：完整开发指南

PayPal 是全球最流行的在线支付平台之一，本文将详细讲解如何在 WordPress 电商网站中集成 PayPal SDK，实现安全、高效的支付功能。

## 一、PayPal 集成方式选择

### 三种主流集成方式对比

```markdown
1. WooCommerce 插件（最简单）
   ✅ 无需编码
   ✅ 官方支持
   ✅ 功能完善
   ❌ 灵活性较低
   适合：非技术人员

2. PayPal Checkout SDK（推荐）
   ✅ 现代化界面
   ✅ 高度可定制
   ✅ 支持多种支付方式
   ❌ 需要编程知识
   适合：开发者

3. PayPal REST API（高级）
   ✅ 完全控制
   ✅ 适合复杂业务
   ❌ 开发复杂度高
   适合：企业级应用
```

## 二、使用 WooCommerce 集成（零代码方案）

### 1. 安装 WooCommerce

```bash
# 通过 WordPress 后台安装
WordPress 后台 → 插件 → 安装插件 → 搜索 "WooCommerce" → 安装并激活
```

### 2. 配置 PayPal 支付

```markdown
步骤：
1. WooCommerce → 设置 → 付款
2. 找到 "PayPal Standard" 或 "PayPal Checkout"
3. 点击"管理"进行配置

必填信息：
- PayPal 邮箱地址
- 商家 ID（可选）
- API 凭证（高级功能需要）
```

### 3. 获取 PayPal API 凭证

```markdown
步骤：
1. 登录 PayPal Developer Dashboard
   https://developer.paypal.com/

2. 创建应用：
   My Apps & Credentials → Create App

3. 获取凭证：
   - Client ID
   - Secret

4. 配置模式：
   - Sandbox（测试环境）
   - Live（生产环境）
```

### 4. WooCommerce PayPal 配置

```php
// WooCommerce PayPal 设置示例
// 在 WooCommerce → 设置 → 付款 中配置

/*
启用 PayPal: 是
标题: PayPal
描述: 使用 PayPal 安全支付

API 凭证:
Client ID: AXxxxxxxxxxxxxxxxxxxxx
Secret: EJxxxxxxxxxxxxxxxxxxxx

接收器邮箱: your-business@email.com
发票前缀: WC-
*/
```

## 三、使用 PayPal Checkout SDK（开发者方案）

### 1. 创建 PayPal 应用

```markdown
1. 访问 PayPal Developer
   https://developer.paypal.com/developer/applications

2. 创建 App
   - App Name: Your Store Name
   - App Type: Merchant

3. 获取凭证
   - Sandbox Client ID
   - Live Client ID
```

### 2. 在 WordPress 中加载 PayPal SDK

```php
<?php
/**
 * 添加 PayPal SDK 到 WordPress
 * 文件位置: wp-content/themes/your-theme/functions.php
 */

function enqueue_paypal_sdk() {
    // 仅在结账页面加载
    if (is_checkout() || is_page('checkout')) {
        // 从 WordPress 选项获取 Client ID
        $client_id = get_option('paypal_client_id');

        // 设置货币和意图
        $currency = get_woocommerce_currency(); // 例如: USD

        // PayPal SDK URL
        $sdk_url = add_query_arg([
            'client-id' => $client_id,
            'currency' => $currency,
            'intent' => 'capture',
            'components' => 'buttons,messages'
        ], 'https://www.paypal.com/sdk/js');

        wp_enqueue_script(
            'paypal-sdk',
            $sdk_url,
            array(),
            null,
            true
        );

        // 自定义 PayPal 按钮脚本
        wp_enqueue_script(
            'custom-paypal',
            get_template_directory_uri() . '/js/paypal-checkout.js',
            array('jquery', 'paypal-sdk'),
            '1.0',
            true
        );

        // 传递数据到 JavaScript
        wp_localize_script('custom-paypal', 'paypalData', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('paypal_checkout'),
            'currency' => $currency
        ));
    }
}
add_action('wp_enqueue_scripts', 'enqueue_paypal_sdk');
```

### 3. 创建支付按钮

```javascript
// js/paypal-checkout.js
jQuery(document).ready(function($) {

    // 检查 PayPal SDK 是否加载
    if (typeof paypal === 'undefined') {
        console.error('PayPal SDK not loaded');
        return;
    }

    // 渲染 PayPal 按钮
    paypal.Buttons({

        // 设置按钮样式
        style: {
            layout: 'vertical',
            color: 'gold',
            shape: 'rect',
            label: 'paypal',
            height: 45
        },

        // 创建订单
        createOrder: function(data, actions) {
            // 获取购物车数据
            const cartTotal = parseFloat($('.order-total .amount').text().replace(/[^0-9.]/g, ''));
            const currency = paypalData.currency;

            // 获取购物车商品
            const items = [];
            $('.cart-item').each(function() {
                const name = $(this).find('.product-name').text();
                const quantity = parseInt($(this).find('.qty').val());
                const price = parseFloat($(this).find('.product-price').text().replace(/[^0-9.]/g, ''));

                items.push({
                    name: name,
                    unit_amount: {
                        currency_code: currency,
                        value: price.toFixed(2)
                    },
                    quantity: quantity
                });
            });

            // 创建 PayPal 订单
            return actions.order.create({
                purchase_units: [{
                    amount: {
                        currency_code: currency,
                        value: cartTotal.toFixed(2),
                        breakdown: {
                            item_total: {
                                currency_code: currency,
                                value: cartTotal.toFixed(2)
                            }
                        }
                    },
                    items: items,
                    description: 'Order from ' + window.location.hostname
                }],
                application_context: {
                    shipping_preference: 'NO_SHIPPING' // 或 'GET_FROM_FILE'
                }
            });
        },

        // 支付批准后
        onApprove: function(data, actions) {
            // 显示加载状态
            showLoadingOverlay();

            // 捕获支付
            return actions.order.capture().then(function(orderData) {
                console.log('Payment captured:', orderData);

                // 发送到服务器验证和处理
                return $.ajax({
                    url: paypalData.ajax_url,
                    method: 'POST',
                    data: {
                        action: 'process_paypal_payment',
                        nonce: paypalData.nonce,
                        order_id: orderData.id,
                        payer_id: orderData.payer.payer_id,
                        order_data: JSON.stringify(orderData)
                    }
                }).done(function(response) {
                    if (response.success) {
                        // 跳转到成功页面
                        window.location.href = response.data.redirect_url;
                    } else {
                        alert('Payment processing failed: ' + response.data.message);
                        hideLoadingOverlay();
                    }
                }).fail(function() {
                    alert('Server error. Please contact support.');
                    hideLoadingOverlay();
                });
            });
        },

        // 支付取消
        onCancel: function(data) {
            alert('Payment cancelled');
        },

        // 支付错误
        onError: function(err) {
            console.error('PayPal error:', err);
            alert('An error occurred during payment. Please try again.');
        }

    }).render('#paypal-button-container');

    // 辅助函数
    function showLoadingOverlay() {
        $('body').append('<div class="paypal-loading-overlay"><div class="spinner"></div></div>');
    }

    function hideLoadingOverlay() {
        $('.paypal-loading-overlay').remove();
    }
});
```

### 4. 服务器端处理支付

```php
<?php
/**
 * 服务器端处理 PayPal 支付
 * 文件位置: wp-content/themes/your-theme/includes/paypal-handler.php
 */

// 处理 PayPal 支付的 AJAX 回调
add_action('wp_ajax_process_paypal_payment', 'process_paypal_payment');
add_action('wp_ajax_nopriv_process_paypal_payment', 'process_paypal_payment');

function process_paypal_payment() {
    // 验证 nonce
    if (!wp_verify_nonce($_POST['nonce'], 'paypal_checkout')) {
        wp_send_json_error(['message' => 'Invalid nonce']);
        return;
    }

    // 获取 PayPal 订单数据
    $paypal_order_id = sanitize_text_field($_POST['order_id']);
    $order_data = json_decode(stripslashes($_POST['order_data']), true);

    // 验证 PayPal 订单
    $verified = verify_paypal_order($paypal_order_id);

    if (!$verified) {
        wp_send_json_error(['message' => 'Payment verification failed']);
        return;
    }

    // 创建 WooCommerce 订单
    $wc_order_id = create_woocommerce_order($order_data);

    if (!$wc_order_id) {
        wp_send_json_error(['message' => 'Failed to create order']);
        return;
    }

    // 保存 PayPal 交易信息
    update_post_meta($wc_order_id, '_paypal_transaction_id', $paypal_order_id);
    update_post_meta($wc_order_id, '_paypal_payer_id', $order_data['payer']['payer_id']);
    update_post_meta($wc_order_id, '_paypal_payer_email', $order_data['payer']['email_address']);

    // 标记订单为已支付
    $order = wc_get_order($wc_order_id);
    $order->payment_complete($paypal_order_id);
    $order->add_order_note('PayPal payment completed. Transaction ID: ' . $paypal_order_id);

    // 清空购物车
    WC()->cart->empty_cart();

    // 返回成功响应
    wp_send_json_success([
        'redirect_url' => $order->get_checkout_order_received_url()
    ]);
}

/**
 * 验证 PayPal 订单
 */
function verify_paypal_order($order_id) {
    $client_id = get_option('paypal_client_id');
    $secret = get_option('paypal_secret');
    $mode = get_option('paypal_mode', 'sandbox'); // 'sandbox' 或 'live'

    $base_url = $mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    // 获取访问令牌
    $token = get_paypal_access_token($client_id, $secret, $base_url);

    if (!$token) {
        return false;
    }

    // 获取订单详情
    $response = wp_remote_get(
        $base_url . '/v2/checkout/orders/' . $order_id,
        [
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Content-Type' => 'application/json'
            ]
        ]
    );

    if (is_wp_error($response)) {
        error_log('PayPal API error: ' . $response->get_error_message());
        return false;
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);

    // 验证订单状态
    return isset($body['status']) && $body['status'] === 'COMPLETED';
}

/**
 * 获取 PayPal 访问令牌
 */
function get_paypal_access_token($client_id, $secret, $base_url) {
    $response = wp_remote_post(
        $base_url . '/v1/oauth2/token',
        [
            'headers' => [
                'Authorization' => 'Basic ' . base64_encode($client_id . ':' . $secret),
                'Content-Type' => 'application/x-www-form-urlencoded'
            ],
            'body' => 'grant_type=client_credentials'
        ]
    );

    if (is_wp_error($response)) {
        error_log('PayPal token error: ' . $response->get_error_message());
        return false;
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);

    return isset($body['access_token']) ? $body['access_token'] : false;
}

/**
 * 创建 WooCommerce 订单
 */
function create_woocommerce_order($paypal_data) {
    // 创建订单
    $order = wc_create_order();

    // 添加购物车商品到订单
    foreach (WC()->cart->get_cart() as $cart_item_key => $cart_item) {
        $product = $cart_item['data'];
        $order->add_product($product, $cart_item['quantity']);
    }

    // 添加客户信息
    $payer = $paypal_data['payer'];

    $order->set_billing_first_name($payer['name']['given_name']);
    $order->set_billing_last_name($payer['name']['surname']);
    $order->set_billing_email($payer['email_address']);

    // 如果有地址信息
    if (isset($payer['address'])) {
        $address = $payer['address'];
        $order->set_billing_address_1($address['address_line_1'] ?? '');
        $order->set_billing_city($address['admin_area_2'] ?? '');
        $order->set_billing_state($address['admin_area_1'] ?? '');
        $order->set_billing_postcode($address['postal_code'] ?? '');
        $order->set_billing_country($address['country_code'] ?? '');
    }

    // 设置支付方式
    $order->set_payment_method('paypal');
    $order->set_payment_method_title('PayPal');

    // 计算总额
    $order->calculate_totals();

    // 保存订单
    $order->save();

    return $order->get_id();
}
```

### 5. 添加 PayPal 设置页面

```php
<?php
/**
 * PayPal 设置页面
 * 文件位置: wp-content/themes/your-theme/includes/paypal-settings.php
 */

// 添加设置菜单
add_action('admin_menu', 'paypal_settings_menu');

function paypal_settings_menu() {
    add_options_page(
        'PayPal Settings',
        'PayPal',
        'manage_options',
        'paypal-settings',
        'paypal_settings_page'
    );
}

// 注册设置
add_action('admin_init', 'register_paypal_settings');

function register_paypal_settings() {
    register_setting('paypal_settings_group', 'paypal_client_id');
    register_setting('paypal_settings_group', 'paypal_secret');
    register_setting('paypal_settings_group', 'paypal_mode');
}

// 设置页面 HTML
function paypal_settings_page() {
    ?>
    <div class="wrap">
        <h1>PayPal Settings</h1>
        <form method="post" action="options.php">
            <?php settings_fields('paypal_settings_group'); ?>
            <?php do_settings_sections('paypal_settings_group'); ?>

            <table class="form-table">
                <tr>
                    <th scope="row">
                        <label for="paypal_mode">Mode</label>
                    </th>
                    <td>
                        <select name="paypal_mode" id="paypal_mode">
                            <option value="sandbox" <?php selected(get_option('paypal_mode'), 'sandbox'); ?>>
                                Sandbox (Test)
                            </option>
                            <option value="live" <?php selected(get_option('paypal_mode'), 'live'); ?>>
                                Live (Production)
                            </option>
                        </select>
                        <p class="description">Use Sandbox for testing, Live for production</p>
                    </td>
                </tr>

                <tr>
                    <th scope="row">
                        <label for="paypal_client_id">Client ID</label>
                    </th>
                    <td>
                        <input type="text"
                               name="paypal_client_id"
                               id="paypal_client_id"
                               value="<?php echo esc_attr(get_option('paypal_client_id')); ?>"
                               class="regular-text">
                        <p class="description">Get this from PayPal Developer Dashboard</p>
                    </td>
                </tr>

                <tr>
                    <th scope="row">
                        <label for="paypal_secret">Secret</label>
                    </th>
                    <td>
                        <input type="password"
                               name="paypal_secret"
                               id="paypal_secret"
                               value="<?php echo esc_attr(get_option('paypal_secret')); ?>"
                               class="regular-text">
                        <p class="description">Keep this secret secure</p>
                    </td>
                </tr>
            </table>

            <?php submit_button(); ?>
        </form>

        <hr>

        <h2>Test Mode Instructions</h2>
        <p>To test payments in Sandbox mode:</p>
        <ol>
            <li>Create a Sandbox account at <a href="https://developer.paypal.com/developer/accounts" target="_blank">PayPal Developer</a></li>
            <li>Use Sandbox test accounts for buyer and seller</li>
            <li>Use test credit card numbers provided by PayPal</li>
        </ol>

        <h3>Sandbox Test Account Example:</h3>
        <ul>
            <li>Email: sb-buyer@personal.example.com</li>
            <li>Password: (provided by PayPal)</li>
        </ul>
    </div>
    <?php
}
```

## 四、添加 PayPal 按钮到结账页面

```php
<?php
/**
 * 在结账页面添加 PayPal 按钮
 * 文件位置: wp-content/themes/your-theme/woocommerce/checkout/payment.php
 * 或使用 hook
 */

// 方法1: 使用 Hook
add_action('woocommerce_review_order_after_submit', 'add_paypal_button');

function add_paypal_button() {
    ?>
    <div class="paypal-checkout-section">
        <div class="or-divider">
            <span>OR</span>
        </div>
        <div id="paypal-button-container"></div>
    </div>

    <style>
        .paypal-checkout-section {
            margin-top: 20px;
        }

        .or-divider {
            text-align: center;
            margin: 20px 0;
            position: relative;
        }

        .or-divider:before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: #ddd;
        }

        .or-divider span {
            background: #fff;
            padding: 0 15px;
            position: relative;
            z-index: 1;
        }

        #paypal-button-container {
            max-width: 400px;
            margin: 0 auto;
        }

        .paypal-loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .paypal-loading-overlay .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #0070ba;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
    <?php
}
```

## 五、PayPal Webhooks 配置

### 1. 创建 Webhook 端点

```php
<?php
/**
 * PayPal Webhook 处理
 * 文件位置: wp-content/themes/your-theme/includes/paypal-webhooks.php
 */

add_action('rest_api_init', function() {
    register_rest_route('paypal/v1', '/webhook', array(
        'methods' => 'POST',
        'callback' => 'handle_paypal_webhook',
        'permission_callback' => '__return_true'
    ));
});

function handle_paypal_webhook(WP_REST_Request $request) {
    // 获取 webhook 数据
    $body = $request->get_body();
    $data = json_decode($body, true);

    // 验证 webhook 签名
    $verified = verify_webhook_signature($request);

    if (!$verified) {
        error_log('Invalid PayPal webhook signature');
        return new WP_REST_Response(['error' => 'Invalid signature'], 400);
    }

    // 处理不同的事件类型
    $event_type = $data['event_type'] ?? '';

    switch ($event_type) {
        case 'PAYMENT.CAPTURE.COMPLETED':
            handle_payment_completed($data);
            break;

        case 'PAYMENT.CAPTURE.REFUNDED':
            handle_payment_refunded($data);
            break;

        case 'PAYMENT.CAPTURE.DENIED':
            handle_payment_denied($data);
            break;

        default:
            error_log('Unhandled PayPal webhook event: ' . $event_type);
    }

    return new WP_REST_Response(['success' => true], 200);
}

function verify_webhook_signature($request) {
    // 实现 PayPal webhook 签名验证
    // 详见: https://developer.paypal.com/docs/api-basics/notifications/webhooks/notification-messages/

    $headers = $request->get_headers();

    // 获取签名相关 headers
    $transmission_id = $headers['paypal_transmission_id'][0] ?? '';
    $transmission_time = $headers['paypal_transmission_time'][0] ?? '';
    $cert_url = $headers['paypal_cert_url'][0] ?? '';
    $auth_algo = $headers['paypal_auth_algo'][0] ?? '';
    $transmission_sig = $headers['paypal_transmission_sig'][0] ?? '';

    $webhook_id = get_option('paypal_webhook_id');
    $body = $request->get_body();

    // 调用 PayPal API 验证签名
    $client_id = get_option('paypal_client_id');
    $secret = get_option('paypal_secret');
    $mode = get_option('paypal_mode', 'sandbox');

    $base_url = $mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    $token = get_paypal_access_token($client_id, $secret, $base_url);

    $response = wp_remote_post(
        $base_url . '/v1/notifications/verify-webhook-signature',
        [
            'headers' => [
                'Authorization' => 'Bearer ' . $token,
                'Content-Type' => 'application/json'
            ],
            'body' => json_encode([
                'transmission_id' => $transmission_id,
                'transmission_time' => $transmission_time,
                'cert_url' => $cert_url,
                'auth_algo' => $auth_algo,
                'transmission_sig' => $transmission_sig,
                'webhook_id' => $webhook_id,
                'webhook_event' => json_decode($body, true)
            ])
        ]
    );

    if (is_wp_error($response)) {
        return false;
    }

    $result = json_decode(wp_remote_retrieve_body($response), true);

    return isset($result['verification_status']) &&
           $result['verification_status'] === 'SUCCESS';
}

function handle_payment_completed($data) {
    $transaction_id = $data['resource']['id'] ?? '';

    // 查找对应的订单
    $orders = wc_get_orders([
        'meta_key' => '_paypal_transaction_id',
        'meta_value' => $transaction_id,
        'limit' => 1
    ]);

    if (!empty($orders)) {
        $order = $orders[0];
        $order->add_order_note('PayPal webhook: Payment completed');
    }
}

function handle_payment_refunded($data) {
    $transaction_id = $data['resource']['id'] ?? '';

    $orders = wc_get_orders([
        'meta_key' => '_paypal_transaction_id',
        'meta_value' => $transaction_id,
        'limit' => 1
    ]);

    if (!empty($orders)) {
        $order = $orders[0];
        $order->update_status('refunded');
        $order->add_order_note('PayPal webhook: Payment refunded');
    }
}

function handle_payment_denied($data) {
    $transaction_id = $data['resource']['id'] ?? '';

    $orders = wc_get_orders([
        'meta_key' => '_paypal_transaction_id',
        'meta_value' => $transaction_id,
        'limit' => 1
    ]);

    if (!empty($orders)) {
        $order = $orders[0];
        $order->update_status('failed');
        $order->add_order_note('PayPal webhook: Payment denied');
    }
}
```

### 2. 在 PayPal 配置 Webhook

```markdown
步骤：
1. 登录 PayPal Developer Dashboard
2. 选择你的 App
3. 进入 "Webhooks" 选项卡
4. 点击 "Add Webhook"
5. 输入 Webhook URL:
   https://yoursite.com/wp-json/paypal/v1/webhook

6. 选择要监听的事件:
   - Payment capture completed
   - Payment capture refunded
   - Payment capture denied

7. 保存 Webhook ID 到 WordPress 设置
```

## 六、安全性最佳实践

```php
<?php
/**
 * PayPal 安全性增强
 */

// 1. 加密存储敏感信息
function store_paypal_credentials($client_id, $secret) {
    // 使用 WordPress 密钥加密
    $encrypted_secret = encrypt_data($secret);
    update_option('paypal_client_id', $client_id);
    update_option('paypal_secret_encrypted', $encrypted_secret);
}

function encrypt_data($data) {
    $key = wp_salt('auth');
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($data, 'AES-256-CBC', $key, 0, $iv);
    return base64_encode($iv . $encrypted);
}

function decrypt_data($encrypted_data) {
    $key = wp_salt('auth');
    $data = base64_decode($encrypted_data);
    $iv = substr($data, 0, 16);
    $encrypted = substr($data, 16);
    return openssl_decrypt($encrypted, 'AES-256-CBC', $key, 0, $iv);
}

// 2. 限制 API 调用频率
function check_rate_limit($user_ip) {
    $transient_key = 'paypal_rate_limit_' . md5($user_ip);
    $attempts = get_transient($transient_key);

    if ($attempts && $attempts >= 10) {
        return false; // 超过限制
    }

    set_transient($transient_key, ($attempts ? $attempts + 1 : 1), 3600);
    return true;
}

// 3. 记录所有交易日志
function log_paypal_transaction($type, $data) {
    $log_entry = [
        'timestamp' => current_time('mysql'),
        'type' => $type,
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'data' => $data
    ];

    error_log('PayPal Transaction: ' . json_encode($log_entry));

    // 也可以存储到自定义表
    global $wpdb;
    $wpdb->insert(
        $wpdb->prefix . 'paypal_logs',
        $log_entry,
        ['%s', '%s', '%s', '%s']
    );
}
```

## 七、测试清单

```markdown
测试步骤：

✅ Sandbox 环境测试
  - [ ] 成功支付流程
  - [ ] 取消支付
  - [ ] 支付失败处理
  - [ ] Webhook 接收

✅ 订单创建测试
  - [ ] 订单正确创建
  - [ ] 商品信息正确
  - [ ] 价格计算准确
  - [ ] 客户信息保存

✅ 安全性测试
  - [ ] API 凭证加密
  - [ ] Webhook 签名验证
  - [ ] SQL 注入防护
  - [ ] XSS 防护

✅ 用户体验测试
  - [ ] 加载速度
  - [ ] 移动端响应
  - [ ] 错误提示清晰
  - [ ] 成功页面跳转

✅ 生产环境迁移
  - [ ] 切换到 Live 凭证
  - [ ] 更新 Webhook URL
  - [ ] 真实交易测试
  - [ ] 监控错误日志
```

## 总结

PayPal 集成要点：

1. **选择合适方案**：根据技术能力选择插件或 SDK
2. **安全第一**：加密凭证，验证签名，记录日志
3. **充分测试**：在 Sandbox 环境全面测试
4. **用户体验**：简化支付流程，清晰错误提示
5. **持续监控**：使用 Webhook 追踪交易状态

---

*发布于 2025-12-05 | 电商支付系列*
