import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RATE_LIMITER_SETTINGS,
	normalizeRateLimiterSettings,
	RATE_LIMITER_PRESETS,
	rateLimiterSettingsFromPreset,
} from './rateLimiter';

describe('rateLimiter settings', () => {
	it('provides balanced defaults', () => {
		const settings = normalizeRateLimiterSettings(undefined);
		expect(settings).toEqual({
			...DEFAULT_RATE_LIMITER_SETTINGS,
			...RATE_LIMITER_PRESETS.balanced,
		});
	});

	it('applies presets', () => {
		const settings = rateLimiterSettingsFromPreset('aggressive');
		expect(settings).toMatchObject(RATE_LIMITER_PRESETS.aggressive);
		expect(settings.preset).toBe('aggressive');
	});

	it('clamps custom values and preserves custom preset', () => {
		const settings = normalizeRateLimiterSettings({
			enabled: true,
			preset: 'custom',
			maxConcurrent: 5000,
			maxRatePerWindow: 0,
			rateWindowMs: 10,
			requestTimeoutMs: 100,
			checkIntervalMs: Number.NaN,
		});

		expect(settings).toMatchObject({
			enabled: true,
			preset: 'custom',
			maxConcurrent: 1000,
			maxRatePerWindow: 1,
			rateWindowMs: 100,
			requestTimeoutMs: 1000,
			checkIntervalMs: DEFAULT_RATE_LIMITER_SETTINGS.checkIntervalMs,
		});
	});
});
