import type React from 'react';
import {
	normalizeRateLimiterSettings,
	RATE_LIMITER_PRESET_OPTIONS,
	type RateLimiterSettings,
	rateLimiterSettingsFromPreset,
} from '../../../common/rateLimiter';
import { useSettingsActions, useSettingsStore } from '../../store';
import { useVSCode } from '../../utils/vscode';
import { SegmentedControl, Switch, TextInput } from '../ui';
import { GroupTitle, SettingRow, SettingsGroup } from './SettingsUI';

type NumericField =
	| 'maxConcurrent'
	| 'maxRatePerWindow'
	| 'rateWindowMs'
	| 'requestTimeoutMs'
	| 'checkIntervalMs';

const NUMBER_FIELDS: Array<{
	key: NumericField;
	title: string;
	tooltip: string;
	min: number;
	max: number;
}> = [
	{
		key: 'maxConcurrent',
		title: 'Max concurrent requests',
		tooltip: 'Global cap across all providers and workspaces',
		min: 1,
		max: 1000,
	},
	{
		key: 'maxRatePerWindow',
		title: 'Requests per window',
		tooltip: 'Maximum requests per provider inside the rate window',
		min: 1,
		max: 1000,
	},
	{
		key: 'rateWindowMs',
		title: 'Rate window (ms)',
		tooltip: 'Sliding window length for per-provider rate limiting',
		min: 100,
		max: 600000,
	},
	{
		key: 'requestTimeoutMs',
		title: 'Slot timeout (ms)',
		tooltip: 'Automatically release a concurrency slot after this delay',
		min: 1000,
		max: 600000,
	},
	{
		key: 'checkIntervalMs',
		title: 'Poll interval (ms)',
		tooltip: 'Delay between checks while waiting for a free slot',
		min: 10,
		max: 60000,
	},
];

export const RateLimiterSettingsSection: React.FC = () => {
	const { rateLimiter } = useSettingsStore();
	const { setSettings } = useSettingsActions();
	const { postMessage } = useVSCode();
	const settings = normalizeRateLimiterSettings(rateLimiter);

	const save = (next: RateLimiterSettings) => {
		const normalized = normalizeRateLimiterSettings(next);
		setSettings({ rateLimiter: normalized });
		postMessage({ type: 'updateSettings', settings: { rateLimiter: normalized } });
	};

	const updateNumber = (key: NumericField, raw: string, min: number, max: number) => {
		const value = Number(raw);
		if (!Number.isFinite(value)) return;
		const clamped = Math.min(max, Math.max(min, Math.round(value)));
		save({ ...settings, preset: 'custom', [key]: clamped });
	};

	return (
		<div className="animate-fade-in">
			<GroupTitle>Rate Limiter</GroupTitle>
			<SettingsGroup>
				<SettingRow
					title="Enable rate limiter"
					tooltip="Generates the OpenCode plugin that throttles requests and limits concurrency"
				>
					<Switch checked={settings.enabled} onChange={enabled => save({ ...settings, enabled })} />
				</SettingRow>
				<SettingRow title="Preset" tooltip="Selecting a preset replaces the values below" last>
					<SegmentedControl
						value={settings.preset}
						options={RATE_LIMITER_PRESET_OPTIONS}
						onChange={preset => save(rateLimiterSettingsFromPreset(preset))}
						ariaLabel="Rate limiter preset"
					/>
				</SettingRow>
			</SettingsGroup>

			<SettingsGroup>
				{NUMBER_FIELDS.map((field, index) => (
					<SettingRow
						key={field.key}
						title={field.title}
						tooltip={field.tooltip}
						last={index === NUMBER_FIELDS.length - 1}
					>
						<TextInput
							type="number"
							min={field.min}
							max={field.max}
							value={String(settings[field.key])}
							onChange={e => updateNumber(field.key, e.target.value, field.min, field.max)}
						/>
					</SettingRow>
				))}
			</SettingsGroup>
		</div>
	);
};
