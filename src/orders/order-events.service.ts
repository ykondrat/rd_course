import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface OrderEvent {
  id: number;
  orderId: number
  status: string;
  ts: number;
}

@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderEvent>();
  private readonly seq = new Map<number, number>();
  private readonly history = new Map<number, OrderEvent[]>();

  emit(orderId: number, status: string): OrderEvent {
    const id = (this.seq.get(orderId) ?? 0) + 1;

    this.seq.set(orderId, id);

    const event: OrderEvent = { id, orderId, status, ts: Date.now() };

    const buffer = this.history.get(orderId) ?? [];

    buffer.push(event);

    if (buffer.length > 100) buffer.shift();

    this.history.set(orderId, buffer);

    this.subject.next(event);

    return event;
  }

  stream(): Observable<OrderEvent> {
    return this.subject.asObservable();
  }

  replay(orderId: number, lastSeen: number): OrderEvent[] {
    return (this.history.get(orderId) ?? []).filter((e) => e.id > lastSeen);
  }
}
