export const RATE_LIMITER_PLUGIN_FILE = 'primecode-rate-limiter.js';
export const RATE_LIMITER_LOG_DIR = 'opencode-rate-limiter';

export type RateLimiterPresetId = 'conservative' | 'balanced' | 'aggressive' | 'custom';

export interface RateLimiterSettings {
	enabled: boolean;
	preset: RateLimiterPresetId;
	maxConcurrent: number;
	maxRatePerWindow: number;
	rateWindowMs: number;
	requestTimeoutMs: number;
	checkIntervalMs: number;
}

type RateLimiterPresetValues = Pick<
	RateLimiterSettings,
	'maxConcurrent' | 'maxRatePerWindow' | 'rateWindowMs' | 'requestTimeoutMs' | 'checkIntervalMs'
>;

export const RATE_LIMITER_PRESETS = {
	conservative: {
		maxConcurrent: 5,
		maxRatePerWindow: 1,
		rateWindowMs: 3000,
		requestTimeoutMs: 15000,
		checkIntervalMs: 200,
	},
	balanced: {
		maxConcurrent: 15,
		maxRatePerWindow: 1,
		rateWindowMs: 2000,
		requestTimeoutMs: 15000,
		checkIntervalMs: 200,
	},
	aggressive: {
		maxConcurrent: 25,
		maxRatePerWindow: 2,
		rateWindowMs: 3000,
		requestTimeoutMs: 15000,
		checkIntervalMs: 200,
	},
} as const satisfies Record<Exclude<RateLimiterPresetId, 'custom'>, RateLimiterPresetValues>;

export const DEFAULT_RATE_LIMITER_SETTINGS: RateLimiterSettings = {
	enabled: false,
	preset: 'balanced',
	...RATE_LIMITER_PRESETS.balanced,
};

export const RATE_LIMITER_PRESET_OPTIONS: Array<{
	value: RateLimiterPresetId;
	label: string;
	title: string;
}> = [
	{
		value: 'conservative',
		label: 'Conservative',
		title: '5 concurrent requests, 1 request per 3 seconds per provider',
	},
	{
		value: 'balanced',
		label: 'Balanced',
		title: '15 concurrent requests, 1 request per 2 seconds per provider',
	},
	{
		value: 'aggressive',
		label: 'Aggressive',
		title: '25 concurrent requests, 2 requests per 3 seconds per provider',
	},
	{ value: 'custom', label: 'Custom', title: 'Use the values configured below' },
];

const LIMITS = {
	maxConcurrent: { min: 1, max: 1000 },
	maxRatePerWindow: { min: 1, max: 1000 },
	rateWindowMs: { min: 100, max: 600000 },
	requestTimeoutMs: { min: 1000, max: 600000 },
	checkIntervalMs: { min: 10, max: 60000 },
} as const;

function clampNumber(value: unknown, key: keyof typeof LIMITS, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	const { min, max } = LIMITS[key];
	return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeRateLimiterSettings(raw: unknown): RateLimiterSettings {
	const record =
		raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const preset =
		typeof record.preset === 'string' && record.preset in RATE_LIMITER_PRESETS
			? (record.preset as Exclude<RateLimiterPresetId, 'custom'>)
			: typeof record.preset === 'string' && record.preset === 'custom'
				? 'custom'
				: DEFAULT_RATE_LIMITER_SETTINGS.preset;
	const base = preset === 'custom' ? DEFAULT_RATE_LIMITER_SETTINGS : RATE_LIMITER_PRESETS[preset];

	return {
		enabled:
			typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_RATE_LIMITER_SETTINGS.enabled,
		preset,
		maxConcurrent: clampNumber(record.maxConcurrent, 'maxConcurrent', base.maxConcurrent),
		maxRatePerWindow: clampNumber(
			record.maxRatePerWindow,
			'maxRatePerWindow',
			base.maxRatePerWindow,
		),
		rateWindowMs: clampNumber(record.rateWindowMs, 'rateWindowMs', base.rateWindowMs),
		requestTimeoutMs: clampNumber(
			record.requestTimeoutMs,
			'requestTimeoutMs',
			base.requestTimeoutMs,
		),
		checkIntervalMs: clampNumber(record.checkIntervalMs, 'checkIntervalMs', base.checkIntervalMs),
	};
}

export function rateLimiterSettingsFromPreset(preset: RateLimiterPresetId): RateLimiterSettings {
	const current = normalizeRateLimiterSettings(undefined);
	if (preset === 'custom') return { ...current, preset: 'custom' };
	return { ...current, preset, ...RATE_LIMITER_PRESETS[preset] };
}
