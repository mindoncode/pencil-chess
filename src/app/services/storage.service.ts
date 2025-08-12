import { Injectable, InjectionToken, Inject } from '@angular/core';

export const STORAGE_KEY = new InjectionToken<string>('STORAGE_KEY');

@Injectable()
export class StorageService<T> {
  constructor(@Inject(STORAGE_KEY) private readonly key: string) {}

  load(): T | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  save(state: T): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch {}
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {}
  }
}
