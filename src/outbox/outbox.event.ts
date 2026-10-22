import { buildOrderPlaced, OrderPlacedEvent } from '../messaging/order-placed.event';
import type { Order } from '../orders/orders.service';

export function toOrderPlacedEvent(order: Order): OrderPlacedEvent {
  return buildOrderPlaced(
    {
      orderId: order.id,
      userId: order.user_id,
      totalCents: order.total_cents,
      currency: order.currency,
      items: order.items.map((item) => ({ productId: item.product_id, quantity: item.quantity })),
    },
    order.created_at,
  );
}
