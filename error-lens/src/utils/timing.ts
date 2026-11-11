interface DebounceOptions {
	leading?: boolean;
	trailing?: boolean;
	maxWait?: number;
}

interface Debounced<Args extends unknown[]> {
	(...args: Args): void;
	cancel: () => void;
}

/**
 * Delay `fn` until calls stop for `wait` milliseconds.
 * `leading` runs on the first call, `trailing` runs after the quiet period.
 * `maxWait` forces a call at least that often, which is how throttle is built.
 */
export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	wait: number,
	options: DebounceOptions = {},
): Debounced<Args> {
	const leading = options.leading ?? false;
	const trailing = options.trailing ?? true;
	const maxWait = options.maxWait;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastArgs: Args | undefined;
	let lastCallTime: number | undefined;
	let lastInvokeTime = 0;

	const invoke = (): void => {
		const args = lastArgs;
		lastArgs = undefined;
		lastInvokeTime = Date.now();
		if (args) {
			fn(...args);
		}
	};

	const remaining = (now: number): number => {
		const sinceCall = now - (lastCallTime ?? now);
		const timeWaiting = wait - sinceCall;
		if (maxWait === undefined) {
			return timeWaiting;
		}
		return Math.min(timeWaiting, maxWait - (now - lastInvokeTime));
	};

	const shouldInvoke = (now: number): boolean => {
		if (lastCallTime === undefined) {
			return true;
		}
		const sinceCall = now - lastCallTime;
		const sinceInvoke = now - lastInvokeTime;
		return sinceCall >= wait || sinceCall < 0 || (maxWait !== undefined && sinceInvoke >= maxWait);
	};

	const startTimer = (delay: number): void => {
		timer = setTimeout(onTimer, delay);
	};

	const onTimer = (): void => {
		const now = Date.now();
		if (shouldInvoke(now)) {
			timer = undefined;
			if (trailing && lastArgs) {
				invoke();
			} else {
				lastArgs = undefined;
			}
			return;
		}
		startTimer(remaining(now));
	};

	const debounced = ((...args: Args): void => {
		const now = Date.now();
		const invoking = shouldInvoke(now);
		lastArgs = args;
		lastCallTime = now;

		if (invoking) {
			if (timer === undefined) {
				lastInvokeTime = now;
				startTimer(wait);
				if (leading) {
					invoke();
				}
				return;
			}
			if (maxWait !== undefined) {
				clearTimeout(timer);
				startTimer(wait);
				invoke();
			}
			return;
		}
		if (timer === undefined) {
			startTimer(wait);
		}
	}) as Debounced<Args>;

	debounced.cancel = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		lastArgs = undefined;
		lastCallTime = undefined;
		lastInvokeTime = 0;
	};

	return debounced;
}

export function throttle<Args extends unknown[]>(
	fn: (...args: Args) => void,
	wait: number,
	options: { leading?: boolean; trailing?: boolean } = {},
): Debounced<Args> {
	return debounce(fn, wait, {
		leading: options.leading ?? true,
		trailing: options.trailing ?? true,
		maxWait: wait,
	});
}
