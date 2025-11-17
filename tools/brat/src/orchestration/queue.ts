export type Task<T> = () => Promise<T>;

export class Queue {
  private readonly concurrency: number;
  private active = 0;
  private readonly pending: Array<{
    task: Task<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }> = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.floor(concurrency || 1));
  }

  async add<T>(task: Task<T>): Promise<T> {
    if (this.active < this.concurrency) {
      return this.run(task) as Promise<T>;
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
    });
  }

  private async run<T>(task: Task<T>): Promise<T> {
    this.active++;
    try {
      const result = await task();
      return result;
    } catch (e) {
      throw e;
    } finally {
      this.active--;
      this.drain();
    }
  }

  private drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      this.run(next.task).then(next.resolve, next.reject);
    }
  }
}
