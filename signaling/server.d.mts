export function createSignalingServer(opts?: {
	port?: number;
	log?: ((msg: string) => void) | null;
}): Promise<{ port: number; close(): Promise<void> }>;
