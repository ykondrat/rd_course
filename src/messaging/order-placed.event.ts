export const ORDER_PLACED = 'order.placed';

export interface OrderPlacedData {
  orderId: number;
  userId: number;
  totalCents: number;
  currency: string;
  items: Array<{ productId: number; quantity: number }>;
}

export interface OrderPlacedEvent {
  eventId: string;
  type: typeof ORDER_PLACED;
  occurredAt: string;
  data: OrderPlacedData;
}

export function orderPlacedEventId(orderId: number): string {
  return `order-placed:${orderId}`;
}

export function buildOrderPlaced(data: OrderPlacedData, occurredAt: string): OrderPlacedEvent {
  return {
    eventId: orderPlacedEventId(data.orderId),
    type: ORDER_PLACED,
    occurredAt,
    data,
  };
}
