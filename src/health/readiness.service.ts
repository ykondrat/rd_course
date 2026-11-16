import { Injectable } from '@nestjs/common';

@Injectable()
export class ReadinessService {
  private listening = false;
  private draining = false;

  markListening(): void {
    this.listening = true;
  }

  startDraining(): void {
    this.draining = true;
  }

  isAcceptingTraffic(): boolean {
    return this.listening && !this.draining;
  }

  isDraining(): boolean {
    return this.draining;
  }
}
