import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'abucay_cache_';

export const cacheData = async <T>(key: string, data: T): Promise<void> => {
    try {
        await AsyncStorage.setItem(
            CACHE_PREFIX + key,
            JSON.stringify({ data, cachedAt: Date.now() })
        );
    } catch (e) {
        console.warn('Cache write failed:', e);
    }
};

export const getCachedData = async <T>(
    key: string,
    maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
): Promise<T | null> => {
    try {
        const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
        return parsed.data as T;
    } catch (e) {
        return null;
    }
};

export const clearCache = async (key: string): Promise<void> => {
    try {
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
    } catch (e) {
        console.warn('Cache clear failed:', e);
    }
};

// Queue SOS events for offline sync
const SOS_QUEUE_KEY = 'sos_offline_queue';

export const queueSOSEvent = async (event: object): Promise<void> => {
    try {
        const raw = await AsyncStorage.getItem(SOS_QUEUE_KEY);
        const queue = raw ? JSON.parse(raw) : [];
        queue.push(event);
        await AsyncStorage.setItem(SOS_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
        console.warn('SOS queue failed:', e);
    }
};

export const getSOSQueue = async (): Promise<object[]> => {
    try {
        const raw = await AsyncStorage.getItem(SOS_QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

export const clearSOSQueue = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(SOS_QUEUE_KEY);
    } catch (e) {
        console.warn('SOS queue clear failed:', e);
    }
};
