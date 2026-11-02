export const kv = (key: string, value: string | number): void => console.log(`${key}=${value}`);
export const hdr = (title: string): void => console.log(`\n── ${title}`);
export const note = (message: string): void => console.log(`   ${message}`);
export const section = (title: string): void => console.log(`\n=== ${title} ===`);
export const log = (tag: string, message: string): void => console.log(`  [${tag}] ${message}`);
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
